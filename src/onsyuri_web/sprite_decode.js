(function () {
  const WORKER_SRC = [
    'self.onmessage = async function(ev) {',
    '  var d = ev.data;',
    '  try {',
    '    var resp = await fetch(d.url);',
    '    var buf = await resp.arrayBuffer();',
    '    var bmp = await createImageBitmap(new Blob([buf], {type:"image/png"}));',
    '    var W = bmp.width, H = bmp.height, cw = Math.floor(W / d.cells);',
    '    var frameBytes = cw * H * 4;',
    '    var wide = new Uint8ClampedArray(frameBytes * d.cells);',
    '    var cv = new OffscreenCanvas(cw, H);',
    '    var cx = cv.getContext("2d", {willReadFrequently:true});',
    '    for (var c = 0; c < d.cells; c++) {',
    '      cx.clearRect(0, 0, cw, H);',
    '      cx.drawImage(bmp, c*cw, 0, cw, H, 0, 0, cw, H);',
    '      var im = cx.getImageData(0, 0, cw, H);',
    '      var s = im.data;',
    '      if (d.format === 0) {',
    '        // ARGB8888 on little-endian: memory order is B,G,R,A',
    '        for (var y = 0; y < H; y++) {',
    '          var so = y * cw * 4, dob = (y * W + c * cw) * 4;',
    '          for (var x = 0; x < cw; x++, so += 4, dob += 4) {',
    '            wide[dob] = s[so+2]; wide[dob+1] = s[so+1];',
    '            wide[dob+2] = s[so]; wide[dob+3] = s[so+3];',
    '          }',
    '        }',
    '      } else {',
    '        // ABGR8888: memory order R,G,B,A == getImageData order, copy per row',
    '        for (var y2 = 0; y2 < H; y2++)',
    '          wide.set(s.subarray(y2*cw*4, y2*cw*4 + cw*4), (y2 * W + c * cw) * 4);',
    '      }',
    '    }',
    '    bmp.close();',
    '    self.postMessage({id:d.id, ok:true, w:cw*d.cells, h:H, bytes:wide.byteLength, data:wide.buffer}, [wide.buffer]);',
    '  } catch (e) {',
    '    self.postMessage({id:d.id, ok:false, error:String(e)});',
    '  }',
    '};'
  ].join('\n');

  let worker = null;
  let nextId = 1;
  const results = new Map();

  function ensureWorker() {
    if (worker) return worker;
    try {
      const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'application/javascript' }));
      worker = new Worker(url);
      worker.onmessage = (ev) => { results.set(ev.data.id, ev.data); };
      worker.onerror = () => { worker = null; };
    } catch (e) {
      worker = null;
    }
    return worker;
  }

  self.__onsSprite = {
    available: function () { return !!ensureWorker(); },
    submit: function (url, cells, format) {
      const w = ensureWorker();
      if (!w) return 0;
      const id = nextId++;
      results.set(id, { id: id, pending: true });
      let real = url;
      const lower = url.toLowerCase();
      const idx = self.g_onsyuri_index;
      if (idx && idx.files) {
        const f = idx.files.find(x => (x.path || '').toLowerCase() === lower);
        if (f && f.url) real = f.url;
      }
      if (real === url) {
        const fm = self.g_onsyuri_filemap;
        if (fm) {
          const key = Object.keys(fm).find(k => k.toLowerCase().endsWith('/' + lower));
          if (key && fm[key] && fm[key].url) real = fm[key].url;
        }
      }
      const absUrl = new URL(real, self.location.href).href;
      w.postMessage({ id: id, url: absUrl, cells: cells, format: format });
      return id;
    },
    isReady: function (id) {
      const r = results.get(id);
      return !!(r && !r.pending);
    },
    ok: function (id) {
      const r = results.get(id);
      return !!(r && r.ok);
    },
    w: function (id) { const r = results.get(id); return r ? (r.w || 0) : 0; },
    h: function (id) { const r = results.get(id); return r ? (r.h || 0) : 0; },
    bytes: function (id) { const r = results.get(id); return r ? (r.bytes || 0) : 0; },
    copyTo: function (id, ptr, pitch) {
      const r = results.get(id);
      if (!r || !r.data) return;
      const m = self.g_onsyuri_module || (typeof window !== 'undefined' && window.g_onsyuri_module);
      if (!m || !m.HEAPU8) return;
      const src = new Uint8Array(r.data);
      const rowBytes = r.w * 4;
      if (!pitch || pitch === rowBytes) {
        m.HEAPU8.set(src, ptr);
      } else {
        for (let y = 0; y < r.h; y++)
          m.HEAPU8.set(src.subarray(y * rowBytes, y * rowBytes + rowBytes), ptr + y * pitch);
      }
    },
    cleanup: function (id) { results.delete(id); }
  };
})();
