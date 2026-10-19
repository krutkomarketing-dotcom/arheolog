// Хранилище правок, истории, сохранённых наборов и обратной связи.
// В приватной ссылке Claude — общая база артефакта (db) и учётка просмотра (user).
// На GitHub Pages и при запуске из папки — localStorage этого браузера.
import { lsGet, lsSet } from './util.js';

const LS = { edits: 'arch.edits', revs: 'arch.revisions', sets: 'arch.savedSets', fb: 'arch.feedback' };

export const store = {
  mode: 'local',
  user: { id: null, name: '', isAdmin: true, avatar: null, org: '' },
  edits: new Map(),
  _onEdits: [],
  db: null,
  downloads: null,

  async init() {
    const c = window.claude;
    if (c && typeof c.use === 'function') {
      const [db, user, downloads] = await Promise.all([
        c.use('db').catch(() => null), c.use('user').catch(() => null), c.use('downloads').catch(() => null),
      ]);
      this.downloads = downloads;
      if (db) {
        this.mode = 'claude';
        this.db = db;
        const me = user ? await user.me() : null;
        this.user = {
          id: me?.id || null,
          name: me?.name || '',
          avatar: me?.avatarUrl || null,
          isAdmin: me ? !!me.canEdit : false,
          org: me?.canEdit ? 'редактор' : 'читатель',
        };
        this._userApi = user;
        db.collection('edits').onSnapshot(snap => {
          this.edits = new Map(snap.docs.filter(d => d.exists).map(d => [+d.id.slice(1), d.data()]));
          this._onEdits.forEach(f => f(this.edits));
        }, () => {});
        return;
      }
    }
    this.mode = 'local';
    this.user = { id: 'local', name: '', avatar: null, isAdmin: true, org: 'правки хранятся в этом браузере' };
    this.edits = new Map(Object.entries(lsGet(LS.edits, {})).map(([k, v]) => [+k, v]));
  },

  onEdits(fn) { this._onEdits.push(fn); },

  async saveEdit(siteId, patch, revision) {
    const rec = { ...patch, updatedAt: new Date().toISOString(), by: this.user.id };
    const rev = { siteId, at: rec.updatedAt, by: this.user.id, ...revision };
    if (this.mode === 'claude') {
      await this.db.doc(`edits/s${siteId}`).set(rec);
      await this.db.collection('revisions').add(rev);
    } else {
      const all = lsGet(LS.edits, {});
      all[siteId] = rec;
      lsSet(LS.edits, all);
      const revs = lsGet(LS.revs, []);
      revs.push(rev);
      lsSet(LS.revs, revs);
      this.edits.set(siteId, rec);
      this._onEdits.forEach(f => f(this.edits));
    }
    return rec;
  },

  async revisions(siteId) {
    let list = [];
    if (this.mode === 'claude') {
      try {
        const snap = await this.db.collection('revisions').where('siteId', '==', siteId).orderBy('at', 'desc').limit(20).get();
        list = snap.docs.map(d => d.data());
      } catch (e) { list = []; }
    } else {
      list = lsGet(LS.revs, []).filter(r => r.siteId === siteId).sort((a, b) => (a.at < b.at ? 1 : -1));
    }
    return list;
  },

  async names(ids) {
    const uniq = [...new Set(ids.filter(Boolean))];
    if (this.mode === 'claude' && this._userApi && uniq.length) {
      try {
        const ps = await this._userApi.profiles(uniq);
        return Object.fromEntries(uniq.map(id => [id, ps[id]?.name || 'Коллега']));
      } catch (e) { /* без имён */ }
    }
    return Object.fromEntries(uniq.map(id => [id, id === 'local' ? 'Вы (этот браузер)' : 'Коллега']));
  },

  async loadSets() {
    if (this.mode === 'claude' && this.user.id) {
      try {
        const snap = await this.db.doc(`data/users/${this.user.id}/profile`).get();
        return snap.exists ? (snap.data().sets || []) : [];
      } catch (e) { return []; }
    }
    return lsGet(LS.sets, []);
  },

  async saveSets(sets) {
    if (this.mode === 'claude' && this.user.id) {
      try { await this.db.doc(`data/users/${this.user.id}/profile`).set({ sets }); return true; } catch (e) { return false; }
    }
    lsSet(LS.sets, sets);
    return true;
  },

  async feedback(obj) {
    const rec = { ...obj, at: new Date().toISOString(), by: this.user.id };
    if (this.mode === 'claude') {
      try { await this.db.collection('feedback').add(rec); return true; } catch (e) { return false; }
    }
    const all = lsGet(LS.fb, []);
    all.push(rec);
    lsSet(LS.fb, all);
    return true;
  },

  async download(filename, text, type) {
    if (this.downloads) {
      try { await this.downloads.save({ filename, data: new Blob([text], { type }) }); return true; } catch (e) { return false; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return true;
  },
};
