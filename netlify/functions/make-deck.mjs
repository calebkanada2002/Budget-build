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

const RULES = `Every option must be under 28 characters. Keep it funny and clean. Real brands, restaurants, famous people, athletes, shows and characters are welcome when they fit the theme. Poke fun lightly, the way fans joke, never cruel.`;
const CAT_SHAPE = `- "o": exactly 10 options ranked from BEST to WORST. Index 0 is the $10 pick (dreamy, amazing), the middle ones are average and ordinary, and the last few are funny, gross or terrible (index 9 is the $1 pick, the worst).
- "a": exactly 10 lists, one per price in the same order as "o", each with 3 MORE different options of the same quality as that price. No repeats anywhere.
- "g": 2 surprise GOOD mystery outcomes (fun jackpots)
- "b": 2 surprise BAD mystery outcomes (funny disasters)`;

// The deck is written in small pieces (a plan, then one call per stop, run at the same time)
// so every call finishes well inside Netlify's 10-second limit.
function buildPrompt(body){
  if(body.type === "plan"){
    const theme = clip(body.theme, 40);
    if(!theme) return null;
    return {max: 300, text: `You are planning a deck for a family-friendly party game called Budget Build. Players build a "${theme}" one stop at a time with a limited budget.

Pick exactly 5 categories (stops) for building a ${theme}. Each is an emoji plus a short name under 20 characters, like "🍕 Crust".

Return ONLY JSON: {"name":"short deck name","emoji":"one emoji","cats":["...","...","...","...","..."]}`};
  }
  // Each stop is split in two halves that run at the same time, so every call stays short:
  //   part "main": the 10 ranked options plus the mystery outcomes
  //   part "alts": 3 extra options for each of the 10 prices
  if(body.type === "cat" || body.type === "homecat"){
    const part = body.part === "alts" ? "alts" : "main";
    let who, rules, stop;
    if(body.type === "cat"){
      const theme = clip(body.theme, 40), cat = clip(body.cat, 30);
      if(!theme || !cat) return null;
      who = `Players build a "${theme}" with a limited budget. This stop is "${cat}".`;
      rules = `Every entry must be under 28 characters. Keep it funny and clean. Real brands, places, famous people and characters are welcome when they fit. Poke fun lightly, never cruel.`;
      stop = "options";
    } else {
      const team = clip(body.team, 40), sport = body.sport, era = body.era, i = +body.pos;
      const list = POSITIONS[sport] ? POSITIONS[sport].split(", ") : null;
      if(!team || !list || !ERA_TEXT[era] || !(i >= 0 && i < list.length)) return null;
      who = `Players draft a ${sport} lineup for the ${team}. This stop is the ${list[i]} position. Use only ${ERA_TEXT[era]}; every player must have really played for the ${team}. If unsure a current player is still on the roster, prefer players you are confident about.`;
      rules = `Every entry must be under 28 characters. Keep it fun, never cruel.`;
      stop = "real players at that position";
    }
    const intro = `You are writing part of a deck for a family-friendly party game called Budget Build. ${who}`;
    if(part === "main") return {max: 900, text: `${intro}

Give:
- "o": exactly 10 ${stop} ranked from BEST to WORST. Index 0 is the $10 pick (amazing), the middle ones are average, and the last few are funny, bad or terrible (index 9 is the $1 pick).
- "g": 2 surprise GOOD mystery outcomes (fun jackpots)
- "b": 2 surprise BAD mystery outcomes (funny disasters)

${rules}

Reply with ONLY this JSON and nothing else: {"o":[10 strings],"g":[2 strings],"b":[2 strings]}`};
    return {max: 1400, text: `${intro}

Give "a": exactly 10 lists, one per price from $10 (amazing) down to $1 (terrible), each with 3 different ${stop} of that quality. $10 is dreamy, $5-$6 is average, $1 is the funny worst. No repeats.

${rules}

Reply with ONLY this JSON and nothing else: {"a":[[3 strings] x10]}`};
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
  const counts = body.type === "plan" || (body.type === "homecat" && +body.pos === 0 && body.part !== "alts");
  if(counts && limited(ip)) return Response.json({error: "rate_limited"}, {status: 429});

  const prompt = buildPrompt(body);
  if(!prompt) return Response.json({error: "bad_request"}, {status: 400});

  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
        max_tokens: prompt.max,
        messages: [{role: "user", content: prompt.text}]
      })
    });
  } catch(e){
    console.error("Could not reach Anthropic", e);
    return Response.json({error: "upstream", status: "network"}, {status: 502});
  }
  if(r.status === 429) return Response.json({error: "rate_limited"}, {status: 429});
  if(!r.ok){
    const detail = await r.text().catch(() => "");
    console.error("Anthropic error", r.status, detail);
    const why = /credit balance/i.test(detail) ? "credits" : /model/i.test(detail) ? "model" : "";
    return Response.json({error: "upstream", status: r.status, why}, {status: 502});
  }
  const data = await r.json().catch(() => ({}));
  const text = (data.content || []).filter(c => c.type === "text").map(c => c.text || "").join("");
  const m = text.match(/\{[\s\S]*\}/);
  try { return Response.json({deck: JSON.parse(m ? m[0] : "")}); }
  catch {
    console.error("Unreadable output", body.type, body.part, data.stop_reason, JSON.stringify(data.usage), (data.content || []).map(c => c.type).join(","), text.slice(0, 500));
    return Response.json({error: "bad_output", status: data.stop_reason === "max_tokens" ? "too_long" : "json"}, {status: 502});
  }
};
