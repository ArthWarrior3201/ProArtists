import {
  requireUser, signOut, getArtist, saveMyArtist, uploadFile, squareImage, searchArtists,
  createSong, listArtistSongs, listFeaturedOn, deleteSong, mediaUrl, ROLES, isApiConfigured, friendlyError,
  saveLyrics, cleanLyrics, lyricLines, isSynced,
} from "/MusicVibe/core/mv.js";
import { el, avatar, artistUrl, songUrl, createPlayer } from "/MusicVibe/core/ui.js";

// Not signed in -> MusicVibe's sign-in page (artist version), then back here.
const { user, profile } = await requireUser();
const $ = (s) => document.querySelector(s);

let me = await getArtist(user.id); // artist profile or null

$("#signout").onclick = async () => { await signOut(); location.replace("/MusicVibe/"); };

function say(msg, kind = "error") {
  const a = $("#alert");
  a.className = "alert" + (msg ? ` show ${kind}` : "");
  a.textContent = msg || "";
  if (msg) a.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function busy(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  say("");
  try { return await fn(); }
  catch (e) { console.error(e); say(friendlyError(e)); }
  finally { btn.disabled = false; btn.textContent = old; }
}

if (!isApiConfigured) say("Storage isn't connected yet. Set API_BASE in MusicVibe/core/supabase-config.js.", "warn");

// ---------------- artist profile ----------------
const pform = $("#profile-form");
let pickedPhoto = null; // File (already square-cropped)

function showPreview() {
  const box = $("#photo-preview");
  box.replaceChildren();
  if (pickedPhoto) {
    const a = el("span", { className: "avatar-box circle" });
    a.style.setProperty("--size", "112px");
    a.append(el("img", { src: URL.createObjectURL(pickedPhoto), alt: "" }));
    box.append(a);
  } else {
    box.append(avatar(me || { name: pform.elements.name.value || profile.display_name }, { size: 112 }));
  }
}

function openProfileForm(editing) {
  $("#profile-form-title").textContent = editing ? "Edit your artist profile" : "Create your artist profile";
  $("#profile-submit").textContent = editing ? "Save Changes" : "Create Artist Profile";
  pform.elements.name.value = me?.name || profile.display_name;
  pform.elements.bio.value = me?.bio || "";
  pform.elements.bio.dispatchEvent(new Event("input"));
  pickedPhoto = null;
  showPreview();
  $("#profile-cancel").hidden = !editing;
  $("#profile-form-panel").hidden = false;
  $("#profile-panel").hidden = true;
}

pform.elements.bio.addEventListener("input", () => {
  pform.querySelector("[data-count]").textContent = `${pform.elements.bio.value.length} / 1500`;
});
pform.elements.name.addEventListener("input", () => { if (!pickedPhoto && !me?.avatar_media_id) showPreview(); });
pform.elements.photo.addEventListener("change", async () => {
  const f = pform.elements.photo.files[0];
  if (!f) return;
  try { pickedPhoto = await squareImage(f, 640); showPreview(); }
  catch { say("Couldn't read that picture. Try a jpg or png."); }
});
$("#profile-cancel").onclick = () => renderProfile();
$("#profile-edit").onclick = () => openProfileForm(true);

pform.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = pform.elements.name.value.trim();
  if (!name) return say("Add your artist name.");
  const wasNew = !me;
  busy(pform.querySelector("[type=submit]"), wasNew ? "Creating…" : "Saving…", async () => {
    let avatarMediaId = me?.avatar_media_id || null;
    if (pickedPhoto) avatarMediaId = (await uploadFile(pickedPhoto)).id;
    me = await saveMyArtist({ name, bio: pform.elements.bio.value, avatarMediaId });
    say(wasNew ? "Your artist profile is live!" : "Artist profile saved.", "info");
    renderProfile();
    refreshSongs();
  });
});

function renderProfile() {
  if (!me) return openProfileForm(false);
  $("#profile-form-panel").hidden = true;
  $("#profile-panel").hidden = false;
  $("#profile-avatar").replaceChildren(avatar(me, { size: 84 }));
  $("#profile-name").textContent = me.name;
  $("#profile-bio").textContent = me.bio || "No description yet.";
  $("#profile-link").href = artistUrl(me.id);
  $("#release-panel").hidden = false;
  $("#songs-panel").hidden = false;
  if (!credits.length) resetCredits();
  else { credits[0].name = me.name; renderCredits(); }
}

// ---------------- credits editor ----------------
// [{ artistId|null, name, roles:Set, canEdit, canDelete, locked }]
let credits = [];
const ROLE_KEYS = Object.keys(ROLES);

function resetCredits() {
  credits = [{ artistId: me.id, name: me.name, roles: new Set(["main"]), locked: true }];
  renderCredits();
}

function renderCredits() {
  const box = $("#credit-rows");
  box.replaceChildren(...credits.map((c, i) => {
    const chips = el("div", { className: "chips" }, ROLE_KEYS.map((r) => {
      const lockedMain = c.locked && r === "main";
      const input = el("input", { type: "checkbox", checked: c.roles.has(r), disabled: lockedMain });
      input.onchange = () => { input.checked ? c.roles.add(r) : c.roles.delete(r); };
      return el("label", { className: "chip" + (lockedMain ? " locked" : "") }, input, ROLES[r]);
    }));
    const who = el("div", { className: "who" },
      c.artistId ? avatar({ name: c.name, avatar_media_id: c.avatarMediaId ?? (c.locked ? me.avatar_media_id : null) }, { size: 32 }) : null,
      el("span", { className: "name", textContent: c.name }),
      el("span", { className: "tag", textContent: c.locked ? "You" : c.artistId ? "On ProArtists" : "Not on ProArtists" }),
      c.locked ? null : Object.assign(el("button", { type: "button", className: "link-btn", textContent: "Remove" }), {
        onclick: () => { credits.splice(i, 1); renderCredits(); },
      }),
    );
    const row = el("div", { className: "credit-row" }, who, chips);
    if (c.artistId && !c.locked) {
      const perm = (key, text) => {
        const input = el("input", { type: "checkbox", checked: !!c[key] });
        input.onchange = () => { c[key] = input.checked; };
        return el("label", {}, input, text);
      };
      row.append(el("div", { className: "perms" }, perm("canEdit", "Can edit song"), perm("canDelete", "Can delete song")));
    }
    return row;
  }));
}

const search = $("#credit-search");
const results = $("#search-results");
let searchSeq = 0;

function addCredit(c) {
  if (c.artistId && credits.some((x) => x.artistId === c.artistId)) return say(`${c.name} is already credited.`);
  credits.push({ roles: new Set(["featured"]), canEdit: false, canDelete: false, ...c });
  renderCredits();
  search.value = "";
  results.hidden = true;
}

search.addEventListener("input", async () => {
  const q = search.value.trim();
  const mine = ++searchSeq;
  if (!q) { results.hidden = true; return; }
  let found = [];
  try { found = (await searchArtists(q)).filter((a) => a.id !== me.id); } catch {}
  if (mine !== searchSeq) return;
  results.replaceChildren(
    ...found.map((a) => Object.assign(el("button", { type: "button" }, avatar(a, { size: 28 }), a.name), {
      onclick: () => addCredit({ artistId: a.id, name: a.name, avatarMediaId: a.avatar_media_id }),
    })),
    Object.assign(el("button", { type: "button" }, el("span", { className: "muted", textContent: "Add by name: " }), q), {
      onclick: () => addCredit({ artistId: null, name: q.slice(0, 60) }),
    }),
  );
  results.hidden = false;
});
search.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); results.querySelector("button")?.click(); } });
document.addEventListener("click", (e) => { if (!e.target.closest(".credit-add")) results.hidden = true; });

// ---------------- release ----------------
const rform = $("#release-form");
rform.addEventListener("submit", (e) => {
  e.preventDefault();
  const title = rform.elements.title.value.trim();
  const audio = rform.elements.audio.files[0];
  const cover = rform.elements.cover.files[0];
  if (!title) return say("Give your song a title.");
  if (!audio) return say("Choose the audio file.");
  if (audio.size > 300 * 1024 * 1024) return say("The audio file is over 300 MB.");
  const empty = credits.find((c) => !c.roles.size);
  if (empty) return say(`Pick at least one role for ${empty.name}.`);

  const bar = $("#release-bar"), text = $("#release-text");
  busy(rform.querySelector("[type=submit]"), "Releasing…", async () => {
    $("#release-progress").hidden = false;
    try {
      let coverMediaId = null;
      if (cover) {
        text.textContent = "Uploading cover…";
        coverMediaId = (await uploadFile(await squareImage(cover, 1000))).id;
      }
      const up = await uploadFile(audio, {
        onProgress: (p) => { bar.style.width = `${Math.round(p * 100)}%`; text.textContent = p < 1 ? `Uploading audio… ${Math.round(p * 100)}%` : "Saving…"; },
      });
      const id = await createSong({
        title, audioMediaId: up.id, coverMediaId, lyrics: rform.elements.lyrics.value,
        credits: credits.map((c) => ({ artistId: c.artistId, name: c.name, roles: [...c.roles], canEdit: c.canEdit, canDelete: c.canDelete })),
      });
      rform.reset();
      resetCredits();
      await refreshSongs(); // list it before announcing it
      say("", "info");
      const a = $("#alert");
      a.className = "alert show info";
      a.replaceChildren(`"${title}" is out! `, el("a", { href: songUrl(id), textContent: "Open the song page →" }));
    } finally {
      $("#release-progress").hidden = true;
      bar.style.width = "0";
    }
  });
});

// ---------------- song lists ----------------
function songItem(song, { sub, canDelete, canEdit = canDelete }) {
  const pic = mediaUrl(song.cover_media_id) || mediaUrl(me?.avatar_media_id) || "/MusicVibe/img/logo-192.png";
  const li = el("li", {},
    el("span", { className: "cover-sm" }, el("img", { src: pic, alt: "", loading: "lazy" })),
    el("span", { className: "t" }, el("a", { href: songUrl(song.id), textContent: song.title }), el("small", { textContent: sub })),
  );
  if (canEdit) {
    const synced = isSynced(song);
    const lyr = el("button", { className: "btn ghost small", type: "button",
      textContent: !song.lyrics ? "Add lyrics" : synced ? "Lyrics ✓" : "Lyrics" });
    lyr.title = !song.lyrics ? "Add lyrics" : synced ? "Lyrics (time-synced)" : "Lyrics (not time-synced yet)";
    lyr.onclick = () => openLyricsEditor(song);
    li.append(lyr);
  }
  if (canDelete) {
    const del = el("button", { className: "btn ghost small", textContent: "Delete" });
    del.onclick = () => {
      if (!confirm(`Delete "${song.title}"? This can't be undone.`)) return;
      busy(del, "Deleting…", async () => { await deleteSong(song); li.remove(); });
    };
    li.append(del);
  }
  return li;
}

async function refreshSongs() {
  if (!me) return;
  try {
    const [mine, featured] = await Promise.all([listArtistSongs(me.id), listFeaturedOn(me.id)]);
    $("#my-songs").replaceChildren(...(mine.length
      ? mine.map((s) => songItem(s, { sub: new Date(s.created_at).toLocaleDateString(), canDelete: true }))
      : [el("li", { className: "muted", textContent: "No songs yet. Release your first one above." })]));
    $("#collab-panel").hidden = !featured.length;
    $("#collab-songs").replaceChildren(...featured.map((s) => songItem(s, {
      sub: s.credit.roles.map((r) => ROLES[r]).join(", ") + (s.credit.can_edit ? " · can edit" : "") + (s.credit.can_delete ? " · can delete" : ""),
      canDelete: s.credit.can_delete,
      canEdit: s.credit.can_edit,
    })));
  } catch (e) { say(friendlyError(e)); }
}

// ---------------- lyrics editor + time-sync tool ----------------
let lyricsModal = null;
function openLyricsEditor(song) {
  lyricsModal?.close();
  let text = song.lyrics || "";
  let times = null; // working sync

  const x = el("button", { className: "share-x", type: "button", title: "Close", textContent: "✕" });
  const body = el("div", { className: "lyr-body" });
  const card = el("div", { className: "share-card lyr-card", role: "dialog" }, x, el("h3", { textContent: `Lyrics · ${song.title}` }), body);
  const back = el("div", { className: "share-backdrop" }, card);
  let player = null;
  let onKey = () => {};
  const keyHandler = (e) => onKey(e);
  const close = () => { player?.pause(); back.remove(); document.removeEventListener("keydown", keyHandler); lyricsModal = null; };
  x.onclick = close;
  document.body.append(back);
  lyricsModal = { close };

  // ---- step 1: edit text ----
  function editStep() {
    player?.pause();
    onKey = () => {};
    const ta = el("textarea", { value: text, maxLength: 20000, placeholder: "One line per line. Leave an empty line between verses." });
    ta.style.minHeight = "300px";
    const msg = el("p", { className: "hint" });
    const synced = isSynced(song);
    const info = el("p", { className: "muted", style: "margin:0 0 10px;font-size:14px",
      textContent: !song.lyrics ? "Paste or type the lyrics, then save. You can time-sync them next."
        : synced ? "These lyrics are time-synced. If you change the lines, you'll need to sync them again." : "These lyrics aren't time-synced yet." });
    const save = el("button", { className: "btn primary small", type: "button", textContent: "Save lyrics" });
    const sync = el("button", { className: "btn ghost small", type: "button", textContent: "Time-sync →" });
    const remove = el("button", { className: "btn ghost small", type: "button", textContent: "Remove lyrics" });
    remove.hidden = !song.lyrics;
    sync.disabled = !text.trim();
    ta.oninput = () => { sync.disabled = !ta.value.trim(); };
    save.onclick = () => busyBtn(save, "Saving…", msg, async () => {
      const newText = cleanLyrics(ta.value);
      const keepSync = isSynced(song) && newText === song.lyrics ? song.lyrics_sync : null;
      Object.assign(song, await saveLyrics(song.id, { lyrics: newText, sync: keepSync }));
      text = song.lyrics || "";
      msg.textContent = keepSync || !newText ? "Saved." : "Saved. Not time-synced yet.";
      msg.className = "hint ok";
      remove.hidden = !song.lyrics;
      refreshSongs();
    });
    sync.onclick = () => { text = cleanLyrics(ta.value); syncStep(); };
    remove.onclick = () => {
      if (!confirm("Remove the lyrics from this song?")) return;
      busyBtn(remove, "Removing…", msg, async () => { Object.assign(song, await saveLyrics(song.id, { lyrics: "" })); close(); refreshSongs(); });
    };
    body.replaceChildren(info, ta, el("div", { className: "row-btns", style: "margin-top:10px" }, save, sync, remove), msg);
    ta.focus();
  }

  // ---- step 2: time-sync ----
  function syncStep() {
    const lines = lyricLines(text);
    const targets = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
    const fresh = () => lines.map(() => null);
    times = isSynced(song) && song.lyrics === text ? [...song.lyrics_sync] : fresh();
    let k = times.every((t, i) => !lines[i].trim() || t != null) && times.some((t) => t != null) ? targets.length : 0;
    if (!k) times = fresh();

    if (!player) player = createPlayer();
    player.load(song);
    const audio = player.audio;
    const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;
    const list = el("div", { className: "sync-list" });
    const rows = lines.map((line, i) => {
      if (!line.trim()) return list.appendChild(el("div", { className: "lyric-gap" }));
      const time = el("span", { className: "sync-time" });
      const row = el("button", { className: "sync-row", type: "button" }, time, el("span", { textContent: line }));
      row.title = "Re-sync from this line";
      row.onclick = () => { // redo from here
        const j = targets.indexOf(i);
        for (let m = j; m < targets.length; m++) times[targets[m]] = null;
        k = j;
        const prev = j > 0 ? times[targets[j - 1]] : 0;
        audio.currentTime = Math.max(0, (prev ?? 0) - 0.5);
        paint();
      };
      row._time = time;
      return list.appendChild(row);
    });
    const tap = el("button", { className: "btn primary sync-tap", type: "button" });
    const undo = el("button", { className: "btn ghost small", type: "button", textContent: "Undo" });
    const restart = el("button", { className: "btn ghost small", type: "button", textContent: "Start over" });
    const save = el("button", { className: "btn primary small", type: "button", textContent: "Save sync" });
    const backBtn = el("button", { className: "btn ghost small", type: "button", textContent: "← Edit text" });
    const msg = el("p", { className: "hint" });

    function paint() {
      rows.forEach((r, i) => {
        if (!r._time) return;
        r._time.textContent = times[i] == null ? "–:––" : fmt(times[i]);
        r.classList.toggle("done", times[i] != null);
        r.classList.toggle("next", targets[k] === i);
      });
      const done = k >= targets.length;
      tap.textContent = done ? "All lines synced ✓" : `Tap when this starts: “${lines[targets[k]].slice(0, 40)}${lines[targets[k]].length > 40 ? "…" : ""}”`;
      tap.disabled = done;
      save.disabled = !done;
      undo.disabled = k === 0;
      const nextRow = rows[targets[Math.min(k, targets.length - 1)]];
      if (nextRow) list.scrollTo({ top: nextRow.offsetTop - list.clientHeight / 2, behavior: "smooth" });
    }
    function doTap() {
      if (k >= targets.length) return;
      if (audio.paused) { player.play(); return; } // first tap starts the song
      const prev = k > 0 ? times[targets[k - 1]] : -1;
      times[targets[k]] = Math.max(Math.round(audio.currentTime * 100) / 100, prev + 0.01);
      k++;
      paint();
    }
    tap.onclick = doTap;
    undo.onclick = () => {
      if (!k) return;
      k--;
      times[targets[k]] = null;
      audio.currentTime = Math.max(0, audio.currentTime - 3);
      paint();
    };
    restart.onclick = () => { times = fresh(); k = 0; audio.currentTime = 0; player.pause(); paint(); };
    backBtn.onclick = () => editStep();
    save.onclick = () => busyBtn(save, "Saving…", msg, async () => {
      Object.assign(song, await saveLyrics(song.id, { lyrics: text, sync: times }));
      msg.textContent = "Saved! Listeners now see the lyrics light up line by line.";
      msg.className = "hint ok";
      refreshSongs();
    });
    onKey = (e) => {
      // Space = Tap (also when a button has focus: preventDefault stops it "clicking" too)
      if (e.code === "Space" && !e.repeat && !e.target.closest?.("textarea, input")) { e.preventDefault(); doTap(); }
    };
    body.replaceChildren(
      el("p", { className: "muted", style: "margin:0 0 10px;font-size:14px",
        textContent: "Press Tap (or Space) the moment each line starts. The first tap starts the song. Made a mistake? Undo, or click a line to redo from there." }),
      player.root, list,
      el("div", { className: "row-btns", style: "margin-top:10px;align-items:center" }, tap),
      el("div", { className: "row-btns", style: "margin-top:8px" }, save, undo, restart, backBtn), msg);
    paint();
  }

  document.addEventListener("keydown", keyHandler);
  editStep();
}

async function busyBtn(btn, label, msgEl, fn) {
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = label;
  msgEl.textContent = ""; msgEl.className = "hint";
  try { await fn(); }
  catch (e) { console.error(e); msgEl.textContent = friendlyError(e); msgEl.className = "hint bad"; }
  finally { btn.disabled = false; btn.textContent = old; }
}

renderProfile();
refreshSongs();
$("#main").hidden = false;
