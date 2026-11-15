// Budget Build: AI deck maker.
// Runs on Netlify so your Anthropic API key stays secret. The browser sends a theme
// (or a team) and this function asks Claude to write the deck.
//
// Environment variables (Netlify > Site configuration > Environment variables):
//   ANTHROPIC_API_KEY  (required)  your key from console.anthropic.com
//   GAME_PASSWORD      (optional)  if set, players must type it before generating decks
//   ANTHROPIC_MODEL    (optional)  defaults to claude-haiku-5-5 (fast and cheap)
//   MAX_DECKS_PER_HOUR (optional)  per player, defaults to 20

const POSITIONS = {
  NBA: "Point Guard, Shooting Guard, Small Forward, Power Forward, Center",
  NFL: "Quarterback, Running Back, Wide Receiver, Tight End, Defense (any defensive player)",
  MLB: "Ace Pitcher, Catcher, Infielder, Outfielder, Slugger (DH)"
};
const ERA_TEXT = {
  cur: "CURRENT players on the team's roster right now",
  ret: "RETIRED franchise legends who played for the team",
  all: "ALL-TIME greats who played for the team, past or present"
};
const clip = (s, n) => String(s || "").replace(/[\u0000-\u001f`$\\]/g, "").trim().slice(0, n);

function buildPrompt(body){
  if(body.type === "theme"){
    const theme = clip(body.theme, 40);
    if(!theme) return null;
    return `You are writing a deck for a family-friendly party game called Budget Build. Players build a "${theme}" one stop at a time with a limited budget.

Make exactly 5 categories (stops) for building a ${theme}. For each category give:
- "n": an emoji plus a short category name (under 20 characters), e.g. "🍕 Crust"
- "o": exactly 10 options ranked from BEST to WORST. Index 0 is the $10 pick (dreamy, luxurious, amazing), the middle ones are average and ordinary, and the last few are funny, gross or terrible (index 9 is the $1 pick, the worst).
- "a": exactly 10 lists, one per price in the same order as "o", each with 3 MORE different options of the same quality as that price (so every price has 4 possible options in total). No repeats anywhere in the category.
- "g": 2 surprise GOOD mystery outcomes (fun jackpots)
- "b": 2 surprise BAD mystery outcomes (funny disasters)

Every option must be under 28 characters. Keep it funny and clean. Real brands, restaurants, famous people, athletes, shows and characters are welcome when they fit the theme (e.g. a real player's shooting, a real restaurant's dish). Poke fun lightly, the way sports and pop-culture fans joke, never cruel.

Return ONLY JSON in this exact shape:
{"name":"short deck name","emoji":"one emoji","cats":[{"n":"...","o":["...x10"],"a":[["...","...","..."],"...x10"],"g":["...","..."],"b":["...","..."]}]}`;
  }
  if(body.type === "home"){
    const team = clip(body.team, 40), sport = body.sport, era = body.era;
    if(!team || !POSITIONS[sport] || !ERA_TEXT[era]) return null;
    return `You are writing a deck for a party game called Budget Build. Players draft a ${sport} lineup for the ${team}, one position at a time, with a limited budget.

Use only ${ERA_TEXT[era]}. Every player must have really played for the ${team}.

Make exactly 5 categories, one per position, in this order: ${POSITIONS[sport]}. For each category give:
- "n": an emoji plus the position name (under 20 characters)
- "o": exactly 10 real players at that position, ranked from BEST (index 0, the $10 pick) to WORST (index 9, the $1 pick). Top picks are stars and fan favorites, the middle are solid players, the bottom can be famous busts or forgettable backups.
- "a": exactly 10 lists, one per price in the same order as "o", each with 3 MORE real players from the team of about the same quality as that price. No player may appear twice in a category.
- "g": 2 surprise GOOD mystery players (underrated gems or cult heroes from the team)
- "b": 2 surprise BAD mystery outcomes (famous busts or funny disasters)

Every entry must be under 28 characters. Keep it fun; poke fun lightly the way fans do, never cruel. If you are unsure a current player is still on the roster, prefer players you are confident about.

Return ONLY JSON in this exact shape:
{"name":"short deck name","emoji":"one emoji","cats":[{"n":"...","o":["...x10"],"a":[["...","...","..."],"...x10"],"g":["...","..."],"b":["...","..."]}]}`;
  }
  return null;
}

// Best-effort limit per player (resets when the function restarts).
const hits = new Map();
function limited(ip){
  const max = +(process.env.MAX_DECKS_PER_HOUR || 20), now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 3600000);
  if(list.length >= max){ hits.set(ip, list); return true; }
  list.push(now); hits.set(ip, list); return false;
}

export default async (req) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if(req.method === "GET") return Response.json({ok: true, ai: !!key, password: !!process.env.GAME_PASSWORD});
  if(req.method !== "POST") return new Response("Method not allowed", {status: 405});
  if(!key) return Response.json({error: "not_configured"}, {status: 503});

  let body;
  try { body = await req.json(); } catch { return Response.json({error: "bad_request"}, {status: 400}); }
  if(process.env.GAME_PASSWORD && body.password !== process.env.GAME_PASSWORD) return Response.json({error: "password"}, {status: 401});

  const ip = req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "anon";
  if(limited(ip)) return Response.json({error: "rate_limited"}, {status: 429});

  const prompt = buildPrompt(body);
  if(!prompt) return Response.json({error: "bad_request"}, {status: 400});

  // Ask Claude with streaming on, and pass the text straight through to the browser.
  // A normal Netlify function is cut off after 10 seconds, which is shorter than it takes
  // to write a whole deck. A streamed response is allowed to keep going (up to 60 seconds).
  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
        max_tokens: 8000,
        stream: true,
        messages: [{role: "user", content: prompt}]
      })
    });
  } catch(e){
    console.error("Could not reach Anthropic", e);
    return Response.json({error: "upstream", detail: "network"}, {status: 502});
  }
  if(r.status === 429) return Response.json({error: "rate_limited"}, {status: 429});
  if(!r.ok){
    const detail = await r.text().catch(() => "");
    console.error("Anthropic error", r.status, detail);
    // 401 = bad or revoked API key, 400/404 = model name problem, 529 = Anthropic overloaded
    const why = /credit balance/i.test(detail) ? "credits" : /model/i.test(detail) ? "model" : "";
    return Response.json({error: "upstream", status: r.status, why}, {status: 502});
  }

  const enc = new TextEncoder(), dec = new TextDecoder();
  const out = new ReadableStream({
    async start(controller){
      const reader = r.body.getReader();
      let buf = "";
      try {
        while(true){
          const {value, done} = await reader.read();
          if(done) break;
          buf += dec.decode(value, {stream: true});
          let i;
          while((i = buf.indexOf("\n")) >= 0){
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if(!line.startsWith("data:")) continue;
            let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
            if(ev.type === "content_block_delta" && ev.delta && ev.delta.text) controller.enqueue(enc.encode(ev.delta.text));
            if(ev.type === "error"){ console.error("Anthropic stream error", JSON.stringify(ev)); controller.enqueue(enc.encode("\n[[ERROR]]")); }
          }
        }
      } catch(e){
        console.error("Stream broke", e); controller.enqueue(enc.encode("\n[[ERROR]]"));
      }
      controller.close();
    }
  });
  return new Response(out, {headers: {"content-type": "text/plain; charset=utf-8", "cache-control": "no-store"}});
};
