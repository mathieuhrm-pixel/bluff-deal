// Transport « relais » pour Bluff & Deal, via Supabase Realtime (WebSocket, port 443).
// Remplace la connexion WebRTC directe : il suffit que chaque appareil ait internet,
// peu importe le wifi, la 4G ou l'isolation entre appareils.
//
// Canaux :
//   bd:<CODE>          joueurs -> hôte (événement "up") + présence (départs)
//   bd:<CODE>:<pid>    hôte -> un joueur (événement "down"), canal privé par joueur
(function () {
  var VERSION = "3"; // à incrémenter avec public/version.json à chaque mise en ligne
  var SUPABASE_URL = "https://vjtkkgtpgnhxtvwslttr.supabase.co";
  var SUPABASE_KEY = "sb_publishable_ZtsRxryVJBZKc5qS_ir8oQ_xEffDNw4";
  var RESEND_MS = 3000;

  // Un client (donc une WebSocket et un registre de canaux) par connexion :
  // supabase-js réutilise un canal existant du même nom, ce qui casse un
  // deuxième abonnement si on rejoint deux fois la même partie.
  function newClient() {
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "bd-" + Math.random() },
      realtime: { params: { eventsPerSecond: 50 } },
    });
  }

  function channel(sb, name, extra) {
    return sb.channel(name, {
      config: Object.assign({ broadcast: { self: false, ack: true } }, extra || {}),
    });
  }

  function shutdown(sb) {
    try { sb.removeAllChannels(); } catch (e) {}
    try { sb.realtime.disconnect(); } catch (e) {}
  }

  // Abonne un canal ; résout au premier SUBSCRIBED, rejette si rien après 15 s.
  // onUp() est appelé à chaque (ré)abonnement réussi.
  function subscribe(ch, onStatus, onUp) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) {
          done = true;
          reject(Object.assign(new Error("relais injoignable"), { type: "network" }));
        }
      }, 15000);
      try {
        ch.subscribe(function (status) {
          if (status === "SUBSCRIBED") {
            if (onStatus) onStatus("ok");
            if (!done) { done = true; clearTimeout(timer); resolve(ch); }
            if (onUp) onUp();
          } else if (done && onStatus && (status === "CHANNEL_ERROR" || status === "TIMED_OUT")) {
            onStatus("reconnexion…");
          }
        });
      } catch (e) {
        if (!done) { done = true; clearTimeout(timer); reject(e); }
      }
    });
  }

  function safeSend(ch, event, payload) {
    try {
      var p = ch.send({ type: "broadcast", event: event, payload: payload });
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  // Hôte : écoute les joueurs, répond à chacun sur son canal privé.
  // Renvoie régulièrement le dernier état à chaque joueur : un message perdu
  // (veille du téléphone, coupure réseau) est rattrapé en quelques secondes.
  function host(code, e) {
    var sb = newClient();
    var base = "bd:" + code;
    var main = channel(sb, base, { presence: { key: "host" } });
    var outs = new Map(); // pid -> { ch, ready, last }
    var closed = false;

    main.on("broadcast", { event: "up" }, function (m) {
      var p = m.payload;
      if (!p || typeof p.pid !== "string") return;
      if (p.bye) { forget(p.pid); if (e.onLeave) e.onLeave(p.pid); return; }
      e.onMessage(p.pid, p.msg);
    });
    main.on("presence", { event: "leave" }, function (m) {
      (m.leftPresences || []).forEach(function (x) {
        if (!x || !x.pid) return;
        var still = Object.values(main.presenceState()).some(function (arr) {
          return arr.some(function (y) { return y.pid === x.pid; });
        });
        if (!still && e.onLeave) e.onLeave(x.pid);
      });
    });

    function forget(pid) {
      var o = outs.get(pid);
      if (o) { outs.delete(pid); try { sb.removeChannel(o.ch); } catch (err) {} }
    }

    function out(pid) {
      var o = outs.get(pid);
      if (o) return o;
      o = { ch: channel(sb, base + ":" + pid), ready: false, last: null };
      outs.set(pid, o);
      subscribe(o.ch, null, function () {
        o.ready = true;
        if (o.last) safeSend(o.ch, "down", o.last);
      }).catch(function () { if (outs.get(pid) === o) outs.delete(pid); });
      return o;
    }

    var resend = setInterval(function () {
      outs.forEach(function (o) {
        if (o.ready && o.last && o.last.type === "state") safeSend(o.ch, "down", o.last);
      });
    }, RESEND_MS);

    return subscribe(main, e.onStatus).then(function () {
      return {
        sendTo: function (pid, msg) {
          if (closed) return;
          var o = out(pid);
          if (msg && msg.type === "state") o.last = msg;
          if (o.ready) safeSend(o.ch, "down", msg);
          else if (!o.last) o.last = msg;
        },
        close: function () {
          closed = true;
          clearInterval(resend);
          shutdown(sb);
        },
      };
    }, function (err) {
      clearInterval(resend);
      shutdown(sb);
      throw err;
    });
  }

  // Joueur : écoute son canal privé, envoie vers l'hôte.
  function join(code, pid, a) {
    var sb = newClient();
    var base = "bd:" + code;
    var main = channel(sb, base, { presence: { key: pid } });
    var mine = channel(sb, base + ":" + pid);
    var lastMsg = Date.now();
    var gotState = false;
    var closed = false;

    // Tant qu'aucun état n'est reçu, on relance l'hôte ; ensuite on surveille le silence.
    var watchdog = setInterval(function () {
      if (closed) return;
      if (!gotState && a.name) safeSend(main, "up", { pid: pid, msg: { type: "hello", pid: pid, name: a.name } });
      if (Date.now() - lastMsg > 10000 && a.onStatus) a.onStatus("en attente de l'hôte… (vérifie le code)");
    }, 2500);

    mine.on("broadcast", { event: "down" }, function (m) {
      lastMsg = Date.now();
      if (m.payload && m.payload.type === "state") gotState = true;
      if (a.onStatus) a.onStatus("ok");
      a.onMessage(m.payload);
    });

    return subscribe(mine, null)
      .then(function () {
        return subscribe(main, a.onStatus, function () {
          try { main.track({ pid: pid }); } catch (err) {}
          if (a.onOpen) setTimeout(a.onOpen, 0);
        });
      })
      .then(function () {
        return {
          send: function (msg) {
            if (msg && msg.type === "hello" && msg.name) a.name = msg.name;
            safeSend(main, "up", { pid: pid, msg: msg });
          },
          close: function () {
            closed = true;
            clearInterval(watchdog);
            safeSend(main, "up", { pid: pid, bye: true });
            setTimeout(function () { shutdown(sb); }, 300);
          },
        };
      }, function (err) {
        closed = true;
        clearInterval(watchdog);
        shutdown(sb);
        throw err;
      });
  }

  window.BDRelay = { host: host, join: join, version: VERSION };

  // Onglet resté ouvert sur une ancienne version : on prévient (sinon l'hôte et
  // les joueurs peuvent parler deux « langues » réseau différentes).
  function checkVersion() {
    fetch("version.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || String(d.v) === VERSION || document.getElementById("bd-update")) return;
        var bar = document.createElement("div");
        bar.id = "bd-update";
        bar.style.cssText = "position:fixed;left:12px;right:12px;bottom:calc(76px + env(safe-area-inset-bottom));z-index:300;background:#ffc94a;color:#2a1b00;padding:12px 14px;border-radius:12px;font-weight:600;display:flex;gap:10px;align-items:center;justify-content:space-between;box-shadow:0 10px 30px rgba(0,0,0,.4)";
        bar.innerHTML = '<span>Nouvelle version du jeu disponible. Recharge avant de lancer une partie.</span>';
        var btn = document.createElement("button");
        btn.textContent = "Recharger";
        btn.style.cssText = "background:#2a1b00;color:#ffc94a;border:0;border-radius:10px;padding:8px 12px;font-weight:700;cursor:pointer";
        btn.onclick = function () { location.reload(); };
        bar.appendChild(btn);
        document.body.appendChild(bar);
      })
      .catch(function () {});
  }
  if (!window.claude) {
    setTimeout(checkVersion, 2000);
    setInterval(checkVersion, 60000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) checkVersion(); });
  }
})();
