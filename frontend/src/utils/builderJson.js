import layerTemplates from "../layers";

export const MAX_BUILDER_FILE_BYTES = 2_000_000;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function cleanArchitecture(architecture) {
  if (!object(architecture) || !Array.isArray(architecture.nodes) || !Array.isArray(architecture.edges)) {
    throw new Error("The file must contain nodes and edges arrays.");
  }
  if (!architecture.nodes.length || architecture.nodes.length > 500 || architecture.edges.length > 2000) {
    throw new Error("The design must contain 1–500 layers and at most 2000 connections.");
  }
  const ids = new Set();
  const nodes = architecture.nodes.map((node, index) => {
    if (!object(node) || typeof node.id !== "string" || !node.id || node.id.length > 200 || ids.has(node.id)) {
      throw new Error("Every layer must have a unique string ID.");
    }
    ids.add(node.id);
    const template = layerTemplates.find(layer => layer.type === node.data?.layerType);
    if (!template) throw new Error(`Unsupported layer type: ${String(node.data?.layerType).slice(0, 80)}`);
    const source = node.data.properties ?? {};
    if (!object(source)) throw new Error("Layer properties must be an object.");
    const properties = {};
    for (const [key, fallback] of Object.entries(template.properties)) {
      const value = Object.hasOwn(source, key) ? source[key] : fallback;
      const allowed = template.propertyConfig[key]?.options;
      if ((allowed && !allowed.some(option => option.value === value))
        || (value !== null && !["string", "number", "boolean"].includes(typeof value))) {
        throw new Error(`Invalid ${template.type} property: ${key}`);
      }
      properties[key] = value;
    }
    const position = node.position ?? { x: index * 180, y: 100 };
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      throw new Error("Layer positions must be finite numbers.");
    }
    // Whitelist renderable fields; never import arbitrary styles, URLs or HTML.
    return {
      id: node.id, type: "default", position: { x: position.x, y: position.y },
      data: { label: typeof node.data.label === "string" ? node.data.label.slice(0, 200) : template.type,
        layerType: template.type, properties },
    };
  });
  const edgeIds = new Set();
  const edges = architecture.edges.map((edge, index) => {
    if (!object(edge) || !ids.has(edge.source) || !ids.has(edge.target)) {
      throw new Error("Every connection must refer to existing layers.");
    }
    const id = edge.id ?? `imported-edge-${index}`;
    if (typeof id !== "string" || !id || id.length > 500 || edgeIds.has(id)) {
      throw new Error("Every connection must have a unique string ID.");
    }
    edgeIds.add(id);
    const result = { id, source: edge.source, target: edge.target };
    for (const key of ["sourceHandle", "targetHandle"]) {
      if (edge[key] != null && typeof edge[key] !== "string") throw new Error("Invalid connection handle.");
      if (edge[key] !== undefined) result[key] = edge[key];
    }
    return result;
  });
  return { nodes, edges };
}

export function parseBuilderJson(text, fallbackName) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("This file is not valid JSON."); }
  if (!object(data)) throw new Error("This file is not a Builder design.");
  const packaged = Object.hasOwn(data, "format");
  if (packaged && (data.format !== "ai-trainer-builder" || data.schema_version !== 1)) {
    throw new Error("Unsupported Builder JSON format or schema version.");
  }
  const modelName = packaged ? data.model_name : fallbackName;
  if (typeof modelName !== "string" || !modelName.trim() || modelName.trim().length > 150) {
    throw new Error("Model name must contain 1–150 characters.");
  }
  return { modelName: modelName.trim(), architecture: cleanArchitecture(packaged ? data.architecture : data) };
}

export function createBuilderExport({ modelName, version, dirty, nodes, edges }) {
  return {
    format: "ai-trainer-builder", schema_version: 1, model_name: modelName.trim(),
    source_version: version || null, draft: dirty, exported_at: new Date().toISOString(),
    architecture: cleanArchitecture({ nodes, edges }),
  };
}
