'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

async function writeLinuxFileAssociations(payload) {
  const desktop = path.join(payload, 'usr/share/applications');
  const mime = path.join(payload, 'usr/share/mime/packages');
  await fs.mkdir(desktop, { recursive: true });
  await fs.mkdir(mime, { recursive: true });
  await fs.writeFile(path.join(desktop, 'slide-studio.desktop'), [
    '[Desktop Entry]', 'Type=Application', 'Name=Slide Studio', 'Comment=Presentation editor',
    'Comment[ko]=프레젠테이션 편집기', 'Exec=/opt/slide-studio/slide-studio %U',
    'TryExec=/opt/slide-studio/slide-studio', 'Icon=slide-studio', 'Terminal=false',
    'Categories=Office;Presentation;', 'StartupWMClass=slide-studio',
    'MimeType=application/vnd.openxmlformats-officedocument.presentationml.presentation;application/x-slide-studio;', '',
  ].join('\n'));
  await fs.writeFile(path.join(mime, 'slide-studio.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/x-slide-studio">
    <comment>Slide Studio presentation (legacy)</comment>
    <comment xml:lang="ko">Slide Studio 프레젠테이션 (이전 형식)</comment>
    <sub-class-of type="application/json"/>
    <glob pattern="*.slide"/>
  </mime-type>
</mime-info>
`);
}

module.exports = { writeLinuxFileAssociations };
