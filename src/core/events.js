// Minimal event bus.
export class Events {
  constructor() { this.map = new Map(); }
  on(name, fn) { let l = this.map.get(name); if (!l) this.map.set(name, l = []); l.push(fn); return () => this.off(name, fn); }
  off(name, fn) { const l = this.map.get(name); if (!l) return; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
  emit(name, data) { const l = this.map.get(name); if (!l) return; for (let i = 0; i < l.length; i++) l[i](data); }
}
