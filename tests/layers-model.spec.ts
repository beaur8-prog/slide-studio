import { test, expect } from "@playwright/test";

test("native PowerPoint object and group renames take priority over automatic Studio labels", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts"),
      { exportPptx, importPptx } = await import("/src/io.ts"),
      { default: JSZip } = await import("/node_modules/.vite/deps/jszip.js");
    const deck = blankDeck();
    deck.slides[0].elements = [
      element("text", {
        id: "automatic-title",
        text: "Title",
        groups: ["automatic-group"],
      }),
    ];
    const zip = await JSZip.loadAsync(await exportPptx(deck)),
      path = "ppt/slides/slide1.xml";
    const xml = new DOMParser().parseFromString(
      await zip.file(path)!.async("string"),
      "application/xml",
    );
    for (const props of xml.getElementsByTagNameNS("*", "cNvPr")) {
      if (props.getAttribute("name") === "automatic-title")
        props.setAttribute("name", "PowerPoint renamed title");
      if (props.getAttribute("name") === "automatic-group")
        props.setAttribute("name", "PowerPoint renamed group");
    }
    zip.file(path, new XMLSerializer().serializeToString(xml));
    return (await importPptx(await zip.generateAsync({ type: "uint8array" })))
      .deck.slides[0].elements[0];
  });
  expect(result.name).toBe("PowerPoint renamed title");
  expect(result.groupNames).toEqual(["PowerPoint renamed group"]);
});

test("legacy object state keeps its automatic UUID private and accepts a native rename", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts"),
      { exportPptx, importPptx } = await import("/src/io.ts"),
      { default: JSZip } = await import("/node_modules/.vite/deps/jszip.js");
    const deck = blankDeck();
    deck.slides[0].elements = [element("text", { text: "Legacy text" })];
    const zip = await JSZip.loadAsync(await exportPptx(deck)),
      path = "ppt/slides/slide1.xml";
    const xml = new DOMParser().parseFromString(
      await zip.file(path)!.async("string"),
      "application/xml",
    );
    for (const state of xml.getElementsByTagNameNS(
      "urn:slide-studio:object-state:v1",
      "state",
    )) {
      state.removeAttribute("key");
      state.removeAttribute("named");
    }
    zip.file(path, new XMLSerializer().serializeToString(xml));
    const automatic = (
      await importPptx(await zip.generateAsync({ type: "uint8array" }))
    ).deck.slides[0].elements[0].name;
    const props = Array.from(xml.getElementsByTagNameNS("*", "cNvPr")).find(
      (node) => node.getAttribute("name") === deck.slides[0].elements[0].id,
    )!;
    props.setAttribute("name", "Legacy external rename");
    zip.file(path, new XMLSerializer().serializeToString(xml));
    const renamed = (
      await importPptx(await zip.generateAsync({ type: "uint8array" }))
    ).deck.slides[0].elements[0].name;
    return { automatic, renamed };
  });
  expect(result.automatic).toBeUndefined();
  expect(result.renamed).toBe("Legacy external rename");
});

test("layer names, duplicate names, own/group visibility and asymmetric borders survive three PPTX round trips", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { exportPptx, importPptx, parseDeckJson, serializeDeck } =
      await import("/src/io.ts");
    let deck = blankDeck();
    const borders = [
      { color: "#FF0000", width: 1 },
      { color: "#00FF00", width: 2 },
      { color: "#0000FF", width: 3 },
      { color: "transparent", width: 0 },
    ];
    deck.slides[0].elements = [
      element("text", {
        id: "a",
        text: "Alpha",
        name: "중복 이름",
        x: 20,
        y: 30,
        width: 300,
        height: 80,
        borders,
        groups: ["outer", "inner"],
        groupNames: ["바깥 그룹", "안쪽 그룹"],
        groupHidden: [true, false],
      }),
      element("text", {
        id: "b",
        text: "Beta",
        name: "중복 이름",
        x: 20,
        y: 200,
        width: 300,
        height: 80,
        borders: [...borders].reverse(),
        hidden: true,
        groups: ["outer", "inner"],
        groupNames: ["바깥 그룹", "안쪽 그룹"],
        groupHidden: [true, false],
      }),
      element("shape", {
        id: "c",
        name: "숨긴 도형",
        x: 600,
        y: 200,
        hidden: true,
      }),
    ];
    deck = parseDeckJson(serializeDeck(deck));
    const states = [deck.slides[0].elements];
    for (let i = 0; i < 3; i++) {
      deck = (await importPptx(await exportPptx(deck))).deck;
      states.push(deck.slides[0].elements);
    }
    return states;
  });
  for (const state of result.slice(1)) {
    expect(state).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(state[i].name).toBe(result[0][i].name);
      expect(!!state[i].hidden).toBe(!!result[0][i].hidden);
      if (i < 2) {
        expect(state[i].groupNames).toEqual(["바깥 그룹", "안쪽 그룹"]);
        expect(state[i].groupHidden).toEqual([true, false]);
        expect(state[i].borders).toEqual(result[0][i].borders);
      }
    }
  }
});

test("group visibility is independent of child visibility and copied groups keep names", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { element } = await import("/src/model.ts");
    const {
      layerTree,
      setLayerHidden,
      renameLayer,
      isElementHidden,
      showAllLayers,
    } = await import("/src/layers.ts");
    const { copyElements, ungroupElements } = await import(
      "/src/object-groups.ts"
    );
    let elements = [
      element("shape", { id: "a", groups: ["g"] }),
      element("text", { id: "b", groups: ["g"], hidden: true }),
    ];
    const key = layerTree(elements)[0].key;
    elements = renameLayer(elements, key, "Title group");
    elements = setLayerHidden(elements, key, true);
    const hidden = elements.map(isElementHidden);
    const ungrouped = ungroupElements(elements, ["a", "b"]);
    elements = setLayerHidden(elements, key, false);
    return {
      hidden,
      unhidden: elements.map(isElementHidden),
      allShown: showAllLayers(elements).map(isElementHidden),
      copied: copyElements(elements).map((e) => ({
        names: e.groupNames,
        hidden: e.hidden,
        groups: e.groups,
      })),
      ungrouped: ungrouped.map((e) => ({ groups: e.groups, hidden: e.hidden })),
    };
  });
  expect(result.hidden).toEqual([true, true]);
  expect(result.unhidden).toEqual([false, true]);
  expect(result.allShown).toEqual([false, false]);
  expect(result.copied.map((e) => e.names)).toEqual([
    ["Title group"],
    ["Title group"],
  ]);
  expect(result.copied[0].groups?.[0]).not.toBe("g");
  expect(result.copied[0].groups).toEqual(result.copied[1].groups);
  expect(result.ungrouped.every((e) => !e.groups?.length && e.hidden)).toBe(
    true,
  );
});

test("layer moves keep groups intact, preserve selected order, reject cross-parent moves and locked objects", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { element } = await import("/src/model.ts");
    const { layerTree, flattenLayers, moveLayers, reorderLayers } =
      await import("/src/layers.ts");
    const elements = [
      element("shape", { id: "a" }),
      element("shape", { id: "b", groups: ["g"] }),
      element("shape", { id: "c", groups: ["g"] }),
      element("text", { id: "d" }),
      element("shape", { id: "e", locked: true }),
    ];
    const key = (id: string) =>
      flattenLayers(layerTree(elements)).find((n) => n.elementId === id)!.key;
    const ids = (items: typeof elements) => items.map((e) => e.id);
    const errors = [];
    for (const run of [
      () => moveLayers(elements, ["e"], "down"),
      () => reorderLayers(elements, ["b"], key("a"), "below"),
      () => moveLayers(elements, ["a", "b"], "up"),
    ]) {
      try {
        run();
      } catch (error) {
        errors.push((error as Error).message);
      }
    }
    return {
      up: ids(moveLayers(elements, ["b", "c"], "up")),
      multi: ids(moveLayers(elements, ["a", "d"], "up")),
      drop: ids(reorderLayers(elements, ["b", "c"], key("a"), "below")),
      errors,
    };
  });
  expect(result.up).toEqual(["a", "d", "b", "c", "e"]);
  expect(result.multi).toEqual(["b", "c", "a", "e", "d"]);
  expect(result.drop).toEqual(["b", "c", "a", "d", "e"]);
  expect(result.errors).toHaveLength(3);
});
