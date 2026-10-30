import type { RecentPresentationFile, PresentationFileContext, OpenPresentationFile } from "./types";

declare global {
  interface Window {
    desktop?: {
      readonly platform?: string;
      readonly windowSessionId?: string;
      pasteTableClipboard?(): Promise<void>;
      editTextClipboard?(action: "copy" | "cut" | "paste"): Promise<void>;
      loadOfficeCalibriFonts?(): Promise<
        Array<{
          family: "Calibri" | "Calibri Light";
          weight: number;
          style: "normal" | "italic";
          bytes: Uint8Array;
        }>
      >;
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
        extensions: ["pptx"];
        context?: { token?: string; saveAs?: boolean };
      }): Promise<string | PresentationFileContext | null>;
      openFile(): Promise<OpenPresentationFile | null>;
      takeRequestedFile?(): Promise<OpenPresentationFile | null>;
      onOpenRequested?(callback: () => void): () => void;
      recentFiles?(): Promise<RecentPresentationFile[]>;
      openRecentFile?(id: string): Promise<OpenPresentationFile>;
      exportPDF(name: string): Promise<string | null>;
      print(): Promise<boolean>;
      onMenu(callback: (action: string) => void): () => void;
    };
  }
}
