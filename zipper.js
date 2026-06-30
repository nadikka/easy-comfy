// ZIP minimal sin dependencias (metodo STORE, sin compresion).
// Los PNG ya vienen comprimidos, asi que STORE no pierde nada y simplifica el codigo.
// Construye un Buffer ZIP a partir de [{ name, data:Buffer }].

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

// Fecha/hora DOS fijas (no usamos Date para mantener salida estable).
const DOS_TIME = 0;
const DOS_DATE = 0x21; // 1980-01-01

function buildZip(files) {
    const locals = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
        const nameBuf = Buffer.from(f.name, 'utf8');
        const data = f.data;
        const crc = crc32(data);

        const local = Buffer.alloc(30 + nameBuf.length);
        local.writeUInt32LE(0x04034b50, 0);      // signature
        local.writeUInt16LE(20, 4);              // version needed
        local.writeUInt16LE(0x0800, 6);          // flags (bit 11 = UTF-8 name)
        local.writeUInt16LE(0, 8);               // method 0 = STORE
        local.writeUInt16LE(DOS_TIME, 10);
        local.writeUInt16LE(DOS_DATE, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);    // compressed size
        local.writeUInt32LE(data.length, 22);    // uncompressed size
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);              // extra len
        nameBuf.copy(local, 30);
        locals.push(local, data);

        const cd = Buffer.alloc(46 + nameBuf.length);
        cd.writeUInt32LE(0x02014b50, 0);         // signature
        cd.writeUInt16LE(20, 4);                 // version made by
        cd.writeUInt16LE(20, 6);                 // version needed
        cd.writeUInt16LE(0x0800, 8);             // flags
        cd.writeUInt16LE(0, 10);                 // method
        cd.writeUInt16LE(DOS_TIME, 12);
        cd.writeUInt16LE(DOS_DATE, 14);
        cd.writeUInt32LE(crc, 16);
        cd.writeUInt32LE(data.length, 20);
        cd.writeUInt32LE(data.length, 24);
        cd.writeUInt16LE(nameBuf.length, 28);
        cd.writeUInt16LE(0, 30);                 // extra len
        cd.writeUInt16LE(0, 32);                 // comment len
        cd.writeUInt16LE(0, 34);                 // disk start
        cd.writeUInt16LE(0, 36);                 // internal attrs
        cd.writeUInt32LE(0, 38);                 // external attrs
        cd.writeUInt32LE(offset, 42);            // local header offset
        nameBuf.copy(cd, 46);
        central.push(cd);

        offset += local.length + data.length;
    }

    const centralBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);                     // disk number
    end.writeUInt16LE(0, 6);                     // cd start disk
    end.writeUInt16LE(files.length, 8);          // entries this disk
    end.writeUInt16LE(files.length, 10);         // total entries
    end.writeUInt32LE(centralBuf.length, 12);    // cd size
    end.writeUInt32LE(offset, 16);               // cd offset
    end.writeUInt16LE(0, 20);                    // comment len

    return Buffer.concat([...locals, centralBuf, end]);
}

module.exports = { buildZip };
