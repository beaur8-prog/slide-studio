'use strict';

// Only for disposable QA profiles. Exercise real dialogs in protection tests;
// fixture replacement must not leave Electron disabled through CDP dialog.accept.
module.exports = async function allowGeneratedDocuments(page, app) {
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
  let fixtureDiscardConfirmations = 0;
  const unexpectedDialogs = [];
  await page.exposeFunction('__qaDiscardGeneratedDocument', () => { fixtureDiscardConfirmations++; });
  const configure = () => {
    const original = window.confirm.bind(window);
    window.confirm = message => {
      if (message === 'PPTX 파일에 저장하지 않은 변경 사항이 있습니다. 저장하지 않고 계속하시겠습니까?\n\n내용을 보관하려면 취소를 누른 뒤 PPTX로 저장해 주세요.') {
        window.__qaDiscardGeneratedDocument();
        return true;
      }
      return original(message);
    };
  };
  await page.addInitScript(configure);
  await page.evaluate(configure);
  page.on('dialog', async dialog => {
    if (dialog.type() === 'beforeunload') return;
    unexpectedDialogs.push({ type: dialog.type(), message: dialog.message() });
    await dialog.dismiss();
  });
  return () => {
    if (unexpectedDialogs.length) throw new Error('Unexpected native dialogs: ' + JSON.stringify(unexpectedDialogs));
    return { fixtureDiscardConfirmations };
  };
};
