/// <reference types="vite/client" />

declare module 'epubjs' {
  export interface PackagingMetadata {
    title: string;
    creator: string;
    cover: string;
    [key: string]: unknown;
  }

  export interface ManifestItem {
    href: string;
    type: string;
    id: string;
  }

  export interface Packaging {
    metadata: PackagingMetadata;
    manifest: Record<string, ManifestItem>;
  }

  export interface NavItem {
    id: string;
    href: string;
    label: string;
    subitems?: NavItem[];
  }

  export interface Navigation {
    toc: NavItem[];
  }

  export interface RenditionAnnotations {
    highlight(
      cfiRange: string,
      data?: object,
      cb?: () => void,
      className?: string,
      styles?: Record<string, string>,
    ): void;
    remove(cfiRange: string, type: string): void;
  }

  export interface Rendition {
    display(target?: string): Promise<void>;
    prev(): Promise<void>;
    next(): Promise<void>;
    destroy(): void;
    on(event: string, cb: (...args: unknown[]) => void): void;
    off(event: string, cb: (...args: unknown[]) => void): void;
    getRange(cfiRange: string): Range | null;
    annotations: RenditionAnnotations;
    themes: {
      default(styles: Record<string, Record<string, string>>): void;
      register(name: string, styles: Record<string, Record<string, string>>): void;
      select(name: string): void;
      fontSize(size: string): void;
    };
  }

  export interface Book {
    ready: Promise<void>;
    packaging: Packaging;
    navigation: Navigation;
    archive: { getBlob(path: string, mimeType: string): Promise<Blob> };
    coverUrl(): Promise<string | null>;
    renderTo(
      el: HTMLElement,
      opts?: {
        width?: string | number;
        height?: string | number;
        spread?: string;
        flow?: string;
      },
    ): Rendition;
    destroy(): void;
  }

  export default function ePub(data: ArrayBuffer | string): Book;
}

declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
