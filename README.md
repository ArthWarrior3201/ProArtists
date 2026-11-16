# ProArtists

The artist side of MusicVibe: artist profile, upload / edit / delete songs, and manage collaborators and their permissions.
Live at **https://arthwarrior3201.github.io/ProArtists/**

Sign-in is shared with MusicVibe. This site loads `/MusicVibe/core/mv.js`, and both sites are on the same
`arthwarrior3201.github.io` origin, so one login works on both. If you're not signed in, you're sent to
MusicVibe's sign-in page and brought back here afterwards.

GitHub Pages: Settings → Pages → Deploy from branch → `main` / root.

## Status

- [x] Shared sign-in (ProArtists-branded sign-in page + artist email templates)
- [x] Upload / play / delete audio files (stored via the MV-Storage Vercel API)
- [ ] Artist profile
- [ ] Songs (title, cover, release) built on the uploaded files
- [ ] Collaborators (add / remove per song, permissions)
