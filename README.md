# Bluff & Deal

Jeu de négociation multijoueur (bluff, BATNA, événements surprises). Site statique déployé sur Vercel.

- `public/index.html` : le jeu (application monofichier).
- `public/peerjs.min.js` : PeerJS 1.5.5, auto-hébergé.

## Mode en ligne

Pair-à-pair WebRTC via PeerJS : le navigateur de l'hôte fait office de serveur, les autres s'y connectent avec le code de partie (ou le QR code).
Signalisation : serveur cloud public PeerJS (`0.peerjs.com`). Relais TURN : serveurs publics PeerJS, pour les réseaux qui bloquent la connexion directe (4G, réseaux d'entreprise).

L'hôte doit garder l'onglet ouvert pendant toute la partie.

Paramètres d'URL :
- `?net=local` : test sur un seul ordinateur (plusieurs onglets).
- `?peerhost=…&peerport=…&peersecure=1` : utiliser son propre PeerServer.
