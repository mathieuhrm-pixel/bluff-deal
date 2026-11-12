// Transport « relais » pour Bluff & Deal, via Supabase Realtime (WebSocket, port 443).
// Remplace la connexion WebRTC directe : il suffit que chaque appareil ait internet,
// peu importe le wifi, la 4G ou l'isolation entre appareils.
//
// Canaux :
//   bd:<CODE>          joueurs -> hôte (événement "up") + présence (départs)
//   bd:<CODE>:<pid>    hôte -> un joueur (événement "down"), canal privé par joueur
(function () {
  var SUPABASE_URL = "https://vjtkkgtpgnhxtvwslttr.supabase.co";
  var SUPABASE_KEY = "sb_publishable_ZtsRxryVJBZKc5qS_ir8oQ_xEffDNw4";

  var client = null;
  function sb() {
    if (!client) {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { params: { eventsPerSecond: 50 } },
      });
    }
    return client;
  }

  function channel(name, extra) {
    return sb().channel(name, {
      config: Object.assign({ broadcast: { self: false, ack: true } }, extra || {}),
    });
  }

  // Abonne un canal ; résout au premier SUBSCRIBED, rejette si rien après 15 s.
  // onUp(first) est appelé à chaque (ré)abonnement réussi.
  function subscribe(ch, onStatus, onUp) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) {
          done = true;
          try { sb().removeChannel(ch); } catch (e) {}
          reject(Object.assign(new Error("relais injoignable"), { type: "network" }));
        }
      }, 15000);
      ch.subscribe(function (status) {
        if (status === "SUBSCRIBED") {
          if (onStatus) onStatus("ok");
          var first = !done;
          if (!done) { done = true; clearTimeout(timer); resolve(ch); }
          if (onUp) onUp(first);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (done && onStatus && status !== "CLOSED") onStatus("reconnexion…");
        }
      });
    });
  }

  function safeSend(ch, event, payload) {
    try {
      var p = ch.send({ type: "broadcast", event: event, payload: payload });
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  // Hôte : écoute les joueurs, répond à chacun sur son canal privé.
  function host(code, e) {
    var base = "bd:" + code;
    var main = channel(base, { presence: { key: "host" } });
    var outs = new Map(); // pid -> { ch, ready, queue }

    main.on("broadcast", { event: "up" }, function (m) {
      var p = m.payload;
      if (!p || typeof p.pid !== "string") return;
      if (p.bye) { if (e.onLeave) e.onLeave(p.pid); return; }
      e.onMessage(p.pid, p.msg);
    });
    main.on("presence", { event: "leave" }, function (m) {
      (m.leftPresences || []).forEach(function (x) {
        if (x && x.pid && e.onLeave) {
          // Un joueur peut avoir plusieurs présences (reconnexion) : on vérifie qu'il est vraiment parti.
          var still = Object.values(main.presenceState()).some(function (arr) {
            return arr.some(function (y) { return y.pid === x.pid; });
          });
          if (!still) e.onLeave(x.pid);
        }
      });
    });

    function out(pid) {
      var o = outs.get(pid);
      if (o) return o;
      o = { ch: channel(base + ":" + pid), ready: false, queue: [] };
      outs.set(pid, o);
      subscribe(o.ch, null, function () {
        o.ready = true;
        var q = o.queue; o.queue = [];
        q.forEach(function (msg) { safeSend(o.ch, "down", msg); });
      }).catch(function () { outs.delete(pid); });
      return o;
    }

    return subscribe(main, e.onStatus).then(function () {
      return {
        sendTo: function (pid, msg) {
          var o = out(pid);
          if (o.ready) safeSend(o.ch, "down", msg);
          else { o.queue.length = 0; o.queue.push(msg); } // seul le dernier état compte
        },
        close: function () {
          outs.forEach(function (o) { sb().removeChannel(o.ch); });
          sb().removeChannel(main);
        },
      };
    });
  }

  // Joueur : écoute son canal privé, envoie vers l'hôte.
  function join(code, pid, a) {
    var base = "bd:" + code;
    var main = channel(base, { presence: { key: pid } });
    var mine = channel(base + ":" + pid);
    var lastMsg = Date.now();
    var watchdog = setInterval(function () {
      if (Date.now() - lastMsg > 9000 && a.onStatus) a.onStatus("en attente de l'hôte… (vérifie le code)");
    }, 3000);

    mine.on("broadcast", { event: "down" }, function (m) {
      lastMsg = Date.now();
      if (a.onStatus) a.onStatus("ok");
      a.onMessage(m.payload);
    });

    return subscribe(mine, null)
      .then(function () {
        return subscribe(main, a.onStatus, function () {
          main.track({ pid: pid });
          if (a.onOpen) setTimeout(a.onOpen, 0);
        });
      })
      .then(function () {
        return {
          send: function (msg) { safeSend(main, "up", { pid: pid, msg: msg }); },
          close: function () {
            clearInterval(watchdog);
            safeSend(main, "up", { pid: pid, bye: true });
            setTimeout(function () {
              sb().removeChannel(mine);
              sb().removeChannel(main);
            }, 300);
          },
        };
      });
  }

  window.BDRelay = { host: host, join: join };
})();
