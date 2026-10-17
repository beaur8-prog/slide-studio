export {};

declare global {
  interface Window {
    desktop?: {
      readonly platform?: string;
      loadOfficeLightFont?(): Promise<Uint8Array | null>;
      setChromeTheme?(theme: "dark" | "light"): Promise<void>;
      setPresentationMode?(enabled: boolean): Promise<void>;
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
