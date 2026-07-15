const layerNormLayer = {
  type: "LayerNorm",
  properties: {
    normalized_shape: 128,
    epsilon: 0.00001,
    elementwise_affine: true,
  },
  propertyConfig: {
    normalized_shape: {
      label: "Normalized Shape",
      type: "select",
      options: [16, 32, 64, 128, 256, 512, 1024].map((value) => ({
        label: `${value}`,
        value,
      })),
    },
    epsilon: {
      label: "Epsilon",
      type: "select",
      options: [
        { label: "1e-3", value: 0.001 },
        { label: "1e-4", value: 0.0001 },
        { label: "1e-5 — Recommended", value: 0.00001 },
        { label: "1e-6", value: 0.000001 },
      ],
    },
    elementwise_affine: {
      label: "Learnable Scale and Bias",
      type: "select",
      options: [
        { label: "Enabled", value: true },
        { label: "Disabled", value: false },
      ],
    },
  },
};

export default layerNormLayer;
