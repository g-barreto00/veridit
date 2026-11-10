const net = require('net');
const testar = (alvo) => new Promise((r) => {
  const [host, port] = alvo.split(':');
  const s = net.connect({ host, port: +port, timeout: 3000 });
  s.on('connect', () => { s.destroy(); r([alvo, 'ALCANÇÁVEL']); });
  s.on('timeout', () => { s.destroy(); r([alvo, 'bloqueado (timeout)']); });
  s.on('error', (e) => r([alvo, `bloqueado (${e.code})`]));
});
Promise.all(process.argv.slice(2).map(testar)).then((rs) => rs.forEach(([a, s]) => console.log(`  ${a.padEnd(22)} ${s}`)));
