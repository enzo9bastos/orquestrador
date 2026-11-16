// Imagens de exemplo para os testes de anexo (todas fictícias, 8x8 pixels).
// As duas de dentro do código foram geradas com a Pillow COM metadados reais:
// câmera "FakeCam Corp", modelo "Model X1" e série "SN-998877" no EXIF; o WebP
// leva também um XMP com "FakeXMP-ID-4242". Servem para provar que a retirada
// de metadados tira mesmo, e que a imagem continua inteira.
const zlib = require('zlib');

const JPG_COM_EXIF = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/4QBkRXhpZgAATU0AKgAAAAgAAwEPAAIAAAANAAAAMgEQAAIAAAAJAAAAQAExAAIAAAARAAAASgAAAABGYWtlQ2FtIENvcnAAAE1vZGVsIFgxAABzZXJpYWwgU04tOTk4ODc3AAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDmv9R/1y/9A/8Arfy+nQoorTCYSGLg6lRu97adfN+f9bn1+IxEqEuSGx//2Q==', 'base64');
const WEBP_COM_EXIF_E_XMP = Buffer.from('UklGRtQAAABXRUJQVlA4WAoAAAAMAAAABwAABwAAVlA4TCQAAAAvB8ABAA9wBY8r+N5Ff/6DB4oBoIHQQwslhJ67xxHR//ibsAhFWElGXAAAAE1NACoAAAAIAAMBDwACAAAADQAAADIBEAACAAAACQAAAEABMQACAAAAEQAAAEoAAAAARmFrZUNhbSBDb3JwAABNb2RlbCBYMQAAc2VyaWFsIFNOLTk5ODg3NwAAWE1QICYAAAA8eDp4bXBtZXRhPkZha2VYTVAtSUQtNDI0MjwveDp4bXBtZXRhPg==', 'base64');

const TABELA = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = TABELA[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function bloco(tipo, dados) {
  const t = Buffer.from(tipo, 'latin1');
  const n = Buffer.alloc(4); n.writeUInt32BE(dados.length);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, dados])));
  return Buffer.concat([n, t, dados, c]);
}
// PNG de verdade (largura x altura, uma cor), com blocos extras opcionais: [[tipo, Buffer]].
function png(largura = 8, altura = 8, extras = [], cor = [200, 40, 40]) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4); ihdr[8] = 8; ihdr[9] = 2;
  const linha = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: largura }, () => cor).flat())]);
  const idat = zlib.deflateSync(Buffer.concat(Array.from({ length: altura }, () => linha)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloco('IHDR', ihdr), ...extras.map(([t, d]) => bloco(t, d)), bloco('IDAT', idat), bloco('IEND', Buffer.alloc(0))]);
}
// PNG com texto, hora e EXIF (o que uma captura de tela ou câmera deixa).
const pngComMetadados = () => png(8, 8, [['tEXt', Buffer.from('Author\0Ana Fictícia SN-5566')], ['eXIf', Buffer.from('MM\0*FakeCam-EXIF-7788')], ['tIME', Buffer.alloc(7)], ['iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0FakeXMP-9911')]]);
// PDF mínimo, com título e autor no Info.
const pdf = () => Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n4 0 obj<</Title(Relatorio ficticio)/Author(Ana)>>endobj\ntrailer<</Root 1 0 R/Info 4 0 R/Size 5>>\n%%EOF\n');

module.exports = { JPG_COM_EXIF, WEBP_COM_EXIF_E_XMP, png, pngComMetadados, pdf, bloco };
