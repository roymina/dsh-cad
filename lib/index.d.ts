import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import type { JsonValue } from '@deepseek-ai/dsh-tools';
export declare const name = "dsh-cad-plugin";
export declare const inject: string[];
export interface Config {
    outputDir: string;
    maxFileSizeMB: number;
    maxEntities: number;
    maxExtractItems: number;
    maxImageDimension: number;
    maxImagePixels?: number;
    maxWarningSamples?: number;
    maxBlockDepth?: number;
    maxBlockInstances?: number;
    maxConcurrent?: number;
    maxWorkerTimeMs?: number;
    allowedInputRoots?: string[];
    maxSvgBytes?: number;
    maxCsvBytes?: number;
    maxTextLength?: number;
    maxTotalVertices?: number;
    maxEntityVertices?: number;
}
export declare const Config: Schema<Config>;
type Warning = {
    code: string;
    message: string;
};
type WarningSummary = {
    total: number;
    byCode: Record<string, number>;
    samples: Warning[];
    truncated: boolean;
};
export type CadError = {
    ok: false;
    error: {
        code: string;
        message: string;
        details?: Record<string, JsonValue>;
    };
};
export type CadSuccess<T extends object> = {
    ok: true;
} & T;
export type CadResponse<T extends object> = CadSuccess<T> | CadError;
declare function extractCadCore(args: {
    path: string;
    section: 'texts' | 'layers' | 'blocks' | 'entities';
    layers?: string[];
    entityTypes?: string[];
    limit?: number;
    offset?: number;
    search?: string;
    handle?: string;
    window?: {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
    };
    nearest?: {
        x: number;
        y: number;
    };
    saveAs?: 'json' | 'csv';
    outputName?: string;
    bom?: boolean;
    summary?: boolean;
}, config: Config, signal?: AbortSignal): Promise<CadError | CadSuccess<{
    section: string;
    total: number;
    offset: number;
    returned: number;
    truncated: boolean;
}> | {
    bytes: number;
    outputBytes: number;
    sha256: string;
    outputPath: string;
    ok: true;
    section: string;
    offset: number;
    total: number;
    returned: number;
    truncated: boolean;
    records: ({
        handle: string | null;
        type: string;
        layer: string;
        invisible: boolean;
    } | {
        name: string | undefined;
        isOn: boolean;
        isFrozen: boolean;
        colorIndex: number;
        entityCount?: undefined;
    } | {
        name: string | undefined;
        entityCount: number;
        isOn?: undefined;
        isFrozen?: undefined;
        colorIndex?: undefined;
    })[];
}>;
declare function exportCadCore(args: {
    path: string;
    format: 'svg' | 'png' | 'dxf';
    outputName?: string;
    layers?: string[];
    layout?: string;
    width?: number;
    height?: number;
    background?: string;
}, config: Config, signal?: AbortSignal): Promise<CadError | CadSuccess<{
    conversionValidation: {
        status: "passed" | "failed";
        checks: {
            textValuesMatch: boolean;
            entityTypesMatch: boolean;
            layersMatch: boolean;
        };
        differences: string[];
        unpreservedObjectTypes: string[];
    };
    lossRisk: {
        level: "none" | "severe" | "warning";
        reasons: string[];
    };
    unpreservedObjectTypes: string[];
    warnings: WarningSummary;
    bytes: number;
    outputBytes: number;
    sha256: string;
    format: string;
    outputPath: string;
}> | CadSuccess<{
    renderedPrimitiveCount: number;
    skippedEntityCount: number;
    unsupportedEntityTypes: Record<string, number>;
    previewCompleteness: number;
    warnings: WarningSummary;
    bytes: number;
    outputBytes: number;
    sha256: string;
    imageWidth: number;
    imageHeight: number;
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
    layout: string;
    sourceEntityCount: number;
    expandedEntityCount: number;
}> | {
    ok: boolean;
    error: {
        code: string;
        message: string;
        details: {
            code: string;
            message: string;
            details?: Record<string, JsonValue>;
        };
    };
    format: string;
    outputPath: string;
    conversionValidation: {
        status: string;
        checks: {
            textValuesMatch: boolean;
            entityTypesMatch: boolean;
            layersMatch: boolean;
        };
        differences: string[];
        unpreservedObjectTypes: string[];
    };
    lossRisk: {
        level: string;
        reasons: string[];
    };
    warnings: WarningSummary;
} | {
    conversionValidation: {
        status: "passed" | "failed";
        checks: {
            textValuesMatch: boolean;
            entityTypesMatch: boolean;
            layersMatch: boolean;
        };
        differences: string[];
        unpreservedObjectTypes: string[];
    };
    lossRisk: {
        level: "none" | "severe" | "warning";
        reasons: string[];
    };
    unpreservedObjectTypes: string[];
    warnings: WarningSummary;
    bytes: number;
    outputBytes: number;
    sha256: string;
    ok: boolean;
    error: {
        code: string;
        message: string;
        details: {
            differences: string[];
        };
    };
    format: string;
    outputPath: string;
}>;
export declare function inspectCad(pathValue: string, config: Config, signal?: AbortSignal): Promise<{}>;
export declare function compareCad(firstPath: string, secondPath: string, config: Config, signal?: AbortSignal): Promise<{}>;
export declare function extractCad(args: Parameters<typeof extractCadCore>[0], config: Config, signal?: AbortSignal): Promise<{}>;
export declare function exportCad(args: Parameters<typeof exportCadCore>[0], config: Config, signal?: AbortSignal): Promise<{}>;
export declare function apply(ctx: Context, config: Config): void;
export {};
