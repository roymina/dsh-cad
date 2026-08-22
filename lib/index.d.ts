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
type ErrorResult = {
    ok: false;
    error: {
        code: string;
        message: string;
        details?: Record<string, JsonValue>;
    };
};
export declare function inspectCad(pathValue: string, config: Config, signal?: AbortSignal): Promise<ErrorResult | {
    ok: boolean;
    inputPath: string;
    format: string;
    version: {
        code: number;
        name: string;
        productRange: string;
    };
    codePage: string | null;
    units: {
        code: number;
        name: string;
    };
    bounds: {
        header: {
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
        actual: {
            min: {
                x: number;
                y: number;
            };
            max: {
                x: number;
                y: number;
            };
        } | null;
        normalizedMillimeters: {
            min: {
                x: number;
                y: number;
            };
            max: {
                x: number;
                y: number;
            };
            units: string;
        } | null;
        matchesHeader: boolean;
        unableTypes: Record<string, number>;
    };
    entityCount: number;
    entityTypes: Record<string, number>;
    layers: {
        name: string;
        isOn: boolean;
        isFrozen: boolean;
        colorIndex: number;
    }[];
    entityCountByLayer: Record<string, number>;
    blocks: {
        name: any;
        entityCount: number;
        nestedBlocks: any[];
    }[];
    scope: {
        modelSpace: {
            entityCount: number;
        };
        paperSpaces: {
            name: string;
            entityCount: number;
        }[];
        blocks: {
            name: any;
            entityCount: number;
            referenceCount: number;
        }[];
        insertCount: number;
        insertReferences: Record<string, number>;
        maxNestedDepth: number;
        circularReferenceCount: number;
        visibility: {
            visible: number;
            hidden: number;
            frozen: number;
            off: number;
            nonPlot: number;
        };
        resources: {
            xrefs: number;
            images: number;
            fonts: number;
            proxyEntities: number;
        };
    };
    geometryMetrics: {
        totalLength: number;
        perimeter: number;
        area: number;
    };
    layerUsage: {
        layers: {
            name: string;
            entityCount: number;
            empty: boolean;
        }[];
        emptyLayers: string[];
    };
    qualityChecks: {
        duplicateHandles: string[];
        zeroLengthLines: number;
        invalidRadii: number;
        openPolylines: number;
        closedContours: number;
    };
    textCount: number;
    warnings: WarningSummary;
}>;
export declare function compareCad(firstPath: string, secondPath: string, config: Config, signal?: AbortSignal): Promise<ErrorResult | {
    ok: boolean;
    firstPath: string;
    secondPath: string;
    equal: boolean;
    differences: {
        texts: boolean;
        entityTypes: boolean;
        layers: boolean;
    };
}>;
export declare function extractCad(args: {
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
}, config: Config, signal?: AbortSignal): Promise<ErrorResult | {
    ok: boolean;
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
        name: any;
        isOn: boolean;
        isFrozen: boolean;
        colorIndex: number;
        entityCount?: undefined;
    } | {
        name: any;
        entityCount: number;
        isOn?: undefined;
        isFrozen?: undefined;
        colorIndex?: undefined;
    })[];
} | {
    ok: boolean;
    section: string;
    total: number;
    offset: number;
    returned: number;
    truncated: boolean;
} | {
    bytes: number;
    outputBytes: number;
    sha256: string;
    outputPath: string;
    ok: boolean;
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
        name: any;
        isOn: boolean;
        isFrozen: boolean;
        colorIndex: number;
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
    layout?: string;
    width?: number;
    height?: number;
    background?: string;
}, config: Config, signal?: AbortSignal): Promise<ErrorResult | {
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
    format: string;
    outputPath: string;
    error?: undefined;
} | {
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
    layout: string;
    sourceEntityCount: number;
    expandedEntityCount: number;
    error?: undefined;
    conversionValidation?: undefined;
    lossRisk?: undefined;
}>;
export declare function apply(ctx: Context, config: Config): void;
export {};
