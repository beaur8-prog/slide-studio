"use strict";
const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const path = require("node:path");

function changedDuringSave() {
  const error = new Error(
    "저장하는 동안 파일이 다시 변경되어 덮어쓰지 않았습니다. 다시 저장하거나 다른 이름으로 저장하세요.",
  );
  error.code = "SLIDE_FILE_CHANGED";
  return error;
}
function saveContext(value) {
  if (value === undefined) return undefined; // Older internal callers keep Save As semantics.
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value.saveAs !== undefined && typeof value.saveAs !== "boolean") ||
    Object.keys(value).some((key) => !["token", "saveAs"].includes(key))
  )
    throw new TypeError("Invalid presentation save context.");
  return value;
}

/** The main process alone resolves previously opened/saved destinations. */
function createPresentationSaver({
  contexts,
  dialog,
  getWindow,
  defaultPath,
  atomicWrite,
  onSaved,
}) {
  return async (file, rawContext) => {
    const context = saveContext(rawContext);
    const known = context && contexts.get(context.token);
    let useChooser = !known || context.saveAs === true;
    let expected;
    if (!useChooser) {
      try {
        expected = await contexts.inspect(known);
        if (expected.status === "missing") useChooser = true;
        else {
          await fs.access(known.path, constants.W_OK);
          if (expected.status === "changed") {
            const result = await dialog.showMessageBox(getWindow(), {
              type: "question",
              title: "원본 파일 변경 확인",
              message: "이 파일이 다른 프로그램에서 변경되었습니다.",
              detail:
                known.path +
                "\n현재 편집 내용을 다른 이름으로 저장하거나, 변경된 원본을 덮어쓸 수 있습니다.",
              buttons: ["다른 이름으로 저장", "덮어쓰기", "취소"],
              defaultId: 0,
              cancelId: 2,
              noLink: true,
            });
            if (result.response === 0) useChooser = true;
            else if (result.response !== 1) return null;
          }
        }
      } catch (error) {
        if (["EACCES", "EPERM", "EROFS"].includes(error.code))
          useChooser = true;
        else throw error;
      }
    }
    let filename = known?.path;
    if (useChooser) {
      let suggestion = await defaultPath(file.name);
      if (known) {
        const directory = await fs
          .stat(path.dirname(known.path))
          .catch(() => null);
        if (directory?.isDirectory()) suggestion = known.path;
      }
      const result = await dialog.showSaveDialog(getWindow(), {
        title:
          context?.saveAs || known ? "Save PowerPoint As" : "Save PowerPoint",
        defaultPath: suggestion,
        filters: [{ name: "PowerPoint Presentation", extensions: ["pptx"] }],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });
      if (result.canceled || !result.filePath) return null;
      filename = /\.pptx$/i.test(result.filePath)
        ? result.filePath
        : result.filePath + ".pptx";
      if (
        filename !== result.filePath &&
        (await fs.stat(filename).then(
          () => true,
          () => false,
        ))
      ) {
        const answer = await dialog.showMessageBox(getWindow(), {
          type: "question",
          message: "같은 이름의 PPTX 파일이 있습니다. 바꾸시겠습니까?",
          detail: filename,
          buttons: ["바꾸기", "취소"],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        });
        if (answer.response !== 0) return null;
      }
      expected = await contexts.inspect({ path: filename });
    }
    if (expected.status !== "missing") {
      if (!expected.digest)
        throw new Error(
          "이 위치에는 저장할 수 없습니다. 다른 파일 이름을 선택하세요.",
        );
      await fs.access(filename, constants.W_OK);
    }
    await atomicWrite(filename, file.data, {
      mode: expected.mode,
      beforeReplace: async () => {
        const now = await contexts.inspect({
          path: filename,
          digest: expected.digest,
        });
        if (
          expected.status === "missing"
            ? now.status !== "missing"
            : now.status !== "unchanged"
        )
          throw changedDuringSave();
        if (now.status !== "missing") await fs.access(filename, constants.W_OK);
      },
    });
    await onSaved(filename);
    return context ? contexts.issue(filename, file.data) : filename;
  };
}
module.exports = { createPresentationSaver };
