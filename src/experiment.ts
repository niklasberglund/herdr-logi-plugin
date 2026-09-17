import { deflateSync } from 'zlib';
import type { PluginSDK } from '@logitech/plugin-sdk';

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function circlePng(size: number, rgb: [number, number, number], filled: boolean): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const cx = size / 2, cy = size / 2, r = size * 0.35, stroke = size * 0.08;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const inside = filled ? d <= r : Math.abs(d - r) <= stroke / 2;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; raw[o + 3] = inside ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const STATES: Array<[[number, number, number], boolean]> = [
  [[0, 200, 80], false], [[230, 40, 40], true], [[240, 180, 0], true], [[0, 200, 80], true],
];
let stateIndex = 0;

export function installImageExperiment(sdk: PluginSDK) {
  const anySdk = sdk as any;
  const client = anySdk._client;
  const original = anySdk._handleMessage.bind(sdk);

  client.onMessage(async (data: Buffer) => {
    const msg = JSON.parse(data.toString('utf8'));
    if (msg.name === 'GetActionImage' && msg.messageType === 'Request') {
      const [rgb, filled] = STATES[stateIndex % STATES.length];
      const png = circlePng(80, rgb, filled);
      const response = {
        id: msg.id, name: 'GetActionImage', messageType: 'Response',
        data: { image: png.toString('base64') }, failed: false, errorMessage: '', errorCode: 0,
      };
      console.log('[experiment] answering GetActionImage', JSON.stringify(msg.parameters), 'state', stateIndex);
      client.sendMessage(response);
      return;
    }
    if (msg.name === 'GetActionImage' || msg.name === 'ActionImageChanged' || msg.name === 'ActionTextChanged') {
      console.log('[experiment] image-related message from server:', JSON.stringify(msg));
    }
    return original(data);
  });

  setInterval(() => {
    stateIndex++;
    const event = {
      id: 0, name: 'ActionImageChanged', messageType: 'Event',
      parameters: { pluginName: process.env.LPS_PLUGIN_NAME, actionName: 'hello_world_action', actionParameter: null },
    };
    console.log('[experiment] pushing ActionImageChanged, state', stateIndex);
    client.sendMessage(event);
  }, 5000);
}
