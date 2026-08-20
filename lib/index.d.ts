import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export declare const name = "dsh-cad-plugin";
export declare const inject: string[];
export interface Config {
    outputDir: string;
    maxFileSizeMB: number;
    maxEntities: number;
    maxExtractItems: number;
    maxImageDimension: number;
}
export declare const Config: Schema<Config>;
type Warning = {
    code: string;
    message: string;
};
type ErrorResult = {
    ok: false;
    error: {
        code: string;
        message: string;
        details?: Record<string, any>;
    };
};
export declare function inspectCad(pathValue: string, config: Config, signal?: AbortSignal): Promise<ErrorResult | {
    ok: boolean;
    inputPath: string;
    format: string;
    version: any;
    codePage: any;
    units: any;
    bounds: {
        min: {
            x: number;
            y: number;
            z: number;
        };
        max: {
            x: number;
            y: number;
            z: number;
        };
    } | null;
    entityCount: number;
    entityTypes: Record<string, number>;
    layers: {
        name: any;
        isOn: boolean;
        isFrozen: boolean;
        colorIndex: any;
    }[];
    entityCountByLayer: Record<string, number>;
    blocks: {
        name: any;
        entityCount: number;
    }[];
    textCount: number;
    warnings: Warning[];
}>;
export declare function extractCad(args: {
    path: string;
    section: 'texts' | 'layers' | 'blocks' | 'entities';
    layers?: string[];
    entityTypes?: string[];
    limit?: number;
    saveAs?: 'json' | 'csv';
    outputName?: string;
}, config: Config, signal?: AbortSignal): Promise<ErrorResult | {
    ok: boolean;
    section: string;
    total: number;
    returned: number;
    truncated: boolean;
    records: ({
        handle: any;
        type: string;
        layer: any;
        invisible: boolean;
    } | {
        name: any;
        isOn: boolean;
        isFrozen: boolean;
        colorIndex: any;
        entityCount?: undefined;
    } | {
        name: any;
        entityCount: number;
        isOn?: undefined;
        isFrozen?: undefined;
        colorIndex?: undefined;
    })[];
} | {
    outputPath: string;
    ok: boolean;
    section: string;
    total: number;
    returned: number;
    truncated: boolean;
    records: ({
        handle: any;
        type: string;
        layer: any;
        invisible: boolean;
    } | {
        name: any;
        isOn: boolean;
        isFrozen: boolean;
        colorIndex: any;
        entityCount?: undefined;
    } | {
        name: any;
        entityCount: number;
        isOn?: undefined;
        isFrozen?: undefined;
        colorIndex?: undefined;
    })[];
}>;
export declare function exportCad(args: {
    path: string;
    format: 'svg' | 'png' | 'dxf';
    outputName?: string;
    layers?: string[];
    width?: number;
    background?: string;
}, config: Config, signal?: AbortSignal): Promise<ErrorResult | {
    ok: boolean;
    format: string;
    outputPath: string;
    warnings: Warning[];
    bounds?: undefined;
    renderedEntityCount?: undefined;
} | {
    ok: boolean;
    format: "svg" | "png";
    outputPath: string;
    bounds: {
        min: {
            x: number;
            y: number;
        };
        max: {
            x: number;
            y: number;
        };
    };
    renderedEntityCount: number;
    warnings: Warning[];
}>;
export declare function apply(ctx: Context, config: Config): void;
export {};
