export {};

declare global {
  interface Window {
    desktop?: {
      readonly platform?: string;
      editTextClipboard?(action: "copy" | "cut" | "paste"): Promise<void>;
      loadOfficeLightFont?(): Promise<Uint8Array | null>;
      setChromeTheme?(theme: "dark" | "light"): Promise<void>;
      setPresentationMode?(enabled: boolean): Promise<void>;
      listCaptureSources?(): Promise<
        Array<{ id: string; name: string; thumbnail: string }>
      >;
      captureSource?(id: string): Promise<string>;
      onPresentationEnded?(callback: () => void): () => void;
      saveFile(payload: {
        name: string;
        data: Uint8Array;
        extensions: string[];
      }): Promise<string | null>;
      openFile(): Promise<{ name: string; data: Uint8Array } | null>;
      exportPDF(name: string): Promise<string | null>;
      print(): Promise<boolean>;
      onMenu(callback: (action: string) => void): () => void;
    };
  }
}
