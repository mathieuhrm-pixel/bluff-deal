# Bluff & Deal

Jeu de négociation multijoueur (bluff, BATNA, événements surprises). Site statique déployé sur Vercel.

- `public/index.html` : le jeu (application monofichier).
- `public/peerjs.min.js` : PeerJS 1.5.5, auto-hébergé.

## Mode en ligne

Relais temps réel **Supabase Realtime** (WebSocket sur le port 443) : l'hôte fait tourner la partie dans son navigateur, les joueurs lui parlent via le relais. Fonctionne quel que soit le réseau (même wifi, 4G, wifi qui isole les appareils…).

- `public/relay.js` : le transport (canal `bd:<CODE>` pour joueurs → hôte, `bd:<CODE>:<pid>` pour hôte → joueur).
- `public/supabase.js` : supabase-js 2.119.0 (UMD), auto-hébergé.
- Projet Supabase : `bluff-deal` (réf. `vjtkkgtpgnhxtvwslttr`), clé publiable dans `relay.js`.
- `api/keepalive.mjs` + cron Vercel quotidien : petite requête en base pour éviter la mise en pause du projet gratuit.

L'hôte doit garder l'onglet ouvert pendant la partie (un rechargement est sans risque).

Paramètres d'URL :
- `?net=peer` : ancien mode pair-à-pair WebRTC (PeerJS).
- `?net=local` : test sur un seul ordinateur (plusieurs onglets).
