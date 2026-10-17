export {};

declare global {
  interface Window {
    desktop?: {
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
