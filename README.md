<div align="center">

# 📚 YggLibrary

### Web Server for .inpx Library Collections on Yggdrasil Network

[![License: CC0](https://img.shields.io/badge/License-CC0%201.0-lightgrey.svg)](LICENSE.md)
[![Node Version](https://img.shields.io/badge/Node-16+-43853d?logo=node.js)](https://nodejs.org/)
[![Yggdrasil](https://img.shields.io/badge/Yggdrasil-Network-green)](https://yggdrasil-network.github.io/)

**Full-featured digital library server with web interface and OPDS support**

**Languages:** 🇬🇧 English | [🇷🇺 Русский](README.ru.md)

[Quick Start](#quick-start) • [Features](#features) • [Installation](#installation) • [Configuration](#configuration)

</div>

---

## Overview

YggLibrary is a web server for searching and browsing digital library collections. It parses .inpx index files (used by MyHomeLib, freeLib, and LightLib) and serves books from ZIP archives via a modern web interface and OPDS server. The server runs natively on Yggdrasil Network IPv6 addresses.

> [!NOTE]
> .inpx is an index file format for importing/exporting information from network library databases into catalog applications like [MyHomeLib](https://alex80.github.io/mhl/), [freeLib](http://sourceforge.net/projects/freelibdesign), or [LightLib](https://lightlib.azurewebsites.net).

---

## Quick Start

**For Users:**

1. Download the latest release from [releases page](https://github.com/JB-SelfCompany/ygglibrary/releases/latest)
2. Place the executable in a directory with your .inpx file and ZIP book archives
3. Run: `./ygglibrary`
4. Access web interface at `http://127.0.0.1:12380`
5. Or use OPDS at `http://127.0.0.1:12380/opds`

**For Developers:**

```bash
git clone https://github.com/JB-SelfCompany/ygglibrary.git
cd ygglibrary
npm install
npm run dev
```

---

## Features

- **Search & Browse** - Multi-field search by author, series, title, genre, language with advanced queries and real-time results
- **Modern UI** - Vue 3 + Quasar framework, responsive design, dark mode, customizable display options
- **OPDS Server** - Full OPDS compliance with authentication, catalog browsing, and search support
- **Performance** - Embedded jembadb database with multi-layer caching (memory + disk), configurable cache sizes, low memory mode
- **Yggdrasil Support** - Native IPv6 support, multi-host binding (IPv4 + Yggdrasil simultaneously)
- **Remote Library** - Client-server mode to separate web interface and file storage
- **Author/Book Filtering** - Create custom collections on the fly with include/exclude filters
- **Auto-reload** - Detects .inpx file changes and rebuilds database automatically
- **Security** - Password protection, session management, HTTPS support via nginx reverse proxy

---

## Installation

### Prerequisites

**Users:** None! Single executable with no dependencies.

**Developers:** [Node.js 16+](https://nodejs.org/) and [npm](https://www.npmjs.com/)

### From Binary

```bash
# Download for your platform from releases page
wget https://github.com/JB-SelfCompany/ygglibrary/releases/latest/download/ygglibrary-linux-x64.tar.gz
tar -xzf ygglibrary-linux-x64.tar.gz
./ygglibrary
```

### From Source

```bash
git clone https://github.com/JB-SelfCompany/ygglibrary.git
cd ygglibrary
npm install
npm run release  # Or: npm run build:linux / build:win / build:macos
```

### CLI Options

```bash
./ygglibrary                            # Default: 127.0.0.1:12380
./ygglibrary --port 8080                # Custom port
./ygglibrary --host 192.168.1.100       # Custom host
./ygglibrary --inpx /path/to/file.inpx  # Specify .inpx file
./ygglibrary --lib-dir /path/to/books   # Specify library directory
./ygglibrary --recreate                 # Force database rebuild
./ygglibrary --help                     # Show all options
```

### Production Setup

<details>
<summary><b>Systemd Service (Linux)</b></summary>

Create `/etc/systemd/system/ygglibrary.service`:

```ini
[Unit]
Description=YggLibrary Server
After=network.target

[Service]
Type=simple
User=ygglibrary
WorkingDirectory=/opt/ygglibrary
ExecStart=/opt/ygglibrary/ygglibrary --data-dir /var/lib/ygglibrary --lib-dir /srv/library
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd --system --no-create-home --shell /bin/false ygglibrary
sudo mkdir -p /opt/ygglibrary /var/lib/ygglibrary
sudo cp ygglibrary /opt/ygglibrary/
sudo systemctl enable --now ygglibrary
```

</details>

<details>
<summary><b>Nginx Reverse Proxy (HTTPS)</b></summary>

```nginx
server {
    listen 80;
    server_name library.example.com;

    location / {
        proxy_pass http://127.0.0.1:12380;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/ygglibrary /etc/nginx/sites-enabled/
sudo certbot --nginx -d library.example.com
```

</details>

---

## Configuration

Configuration file: `<data-dir>/config.json` (auto-created on first run)

### Key Settings

```json
{
  "server": {
    "hosts": ["0.0.0.0"],           // Bind addresses (supports multiple)
    "port": "12380"
  },
  "opds": {
    "enabled": true,
    "user": "",                     // Optional OPDS auth
    "password": "",
    "root": "/opds"
  },
  "accessPassword": "",             // Web interface password
  "dbCacheSize": 5,                 // Cache size (blocks, ~1-10MB each)
  "lowMemoryMode": false,           // Reduce memory usage
  "queryCacheEnabled": true,
  "inpxCheckInterval": 60,          // Auto-reload check (minutes)
  "allowRemoteLib": false,          // Enable remote library server
  "remoteLib": false                // Remote library client config
}
```

### Yggdrasil Support

Bind to multiple addresses including Yggdrasil IPv6:

```json
{
  "server": {
    "hosts": ["0.0.0.0", "200:1234:5678:9abc::1"]  // IPv4 + Yggdrasil
  }
}
```

Or Yggdrasil only:

```json
{
  "server": {
    "hosts": ["200:1234:5678:9abc::1"]  // Yggdrasil only
  }
}
```

### Remote Library Mode

**Server:** `{ "accessPassword": "password", "allowRemoteLib": true }`

**Client:** `{ "remoteLib": { "accessPassword": "password", "url": "ws://server.host:12380" } }`

### Author/Book Filtering

Create `filter.json` in config directory:

```json
{
  "info": { "collection": "My Collection" },
  "includeAuthors": ["Author 1", "Author 2"]
}
```

Or with advanced filtering (requires `--unsafe-filter`):

```json
{
  "filter": "(inpxRec) => inpxRec.del == 0",
  "excludeAuthors": ["Author Name"]
}
```

---

## Architecture

```
Browser ──HTTP──> Server (Node.js)
   │     WebSocket     │
   └──────────────────┘
                      │
                 jembadb (Search DB)
                      │
                 ZIP Files (Books)
```

**WebSocket API** (not REST):
- Search queries → Results
- Book downloads → Links
- Database status
- Configuration

**OPDS Server** at `/opds`:
- Catalog browsing
- Search support
- Downloads
- Basic authentication

---

## Development

```bash
# Run dev server (hot reload enabled)
npm run dev

# Build
npm run build:client        # Frontend only
npm run build:linux         # Linux binary
npm run build:all           # All platforms
npm run release             # Full release
```

**Architecture:**
- Backend: Express.js + WebSocket + jembadb
- Frontend: Vue 3 + Vuex + Quasar + Webpack
- Pattern: Singleton for core modules

---

## Roadmap

- [ ] Multi-language UI (currently Russian only)
- [ ] Docker container
- [ ] More OPDS features (covers, metadata)
- [ ] Reading statistics
- [ ] API documentation

---

## License

**CC0 1.0 Universal (Public Domain)** - see [LICENSE.md](LICENSE.md)

To the extent possible under law, the author has waived all copyright and related or neighboring rights to this work.

---

## Support

- **Issues**: [GitHub Issues](https://github.com/JB-SelfCompany/ygglibrary/issues)
- **Discussions**: [GitHub Discussions](https://github.com/JB-SelfCompany/ygglibrary/discussions)
- **Yggdrasil Network**: [yggdrasil-network.github.io](https://yggdrasil-network.github.io/)

---

## Acknowledgments

- **MyHomeLib** - [alex80.github.io/mhl](https://alex80.github.io/mhl/)
- **freeLib** - [sourceforge.net/projects/freelibdesign](http://sourceforge.net/projects/freelibdesign)
- **LightLib** - [lightlib.azurewebsites.net](https://lightlib.azurewebsites.net)
- **Vue.js** - [vuejs.org](https://vuejs.org/)
- **Quasar Framework** - [quasar.dev](https://quasar.dev/)
- **jembadb** - Custom embedded database

---

<div align="center">

**Made with ❤️ for the decentralized web**

⭐ Star us on GitHub — it helps!

[⬆ Back to Top](#ygglibrary)

</div>