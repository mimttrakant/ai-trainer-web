const batchNorm2dLayer = {
  type: "BatchNorm2D",
  properties: {
    momentum: 0.1,
    epsilon: 0.00001,
    affine: true,
  },
  propertyConfig: {
    momentum: {
      label: "Momentum",
      type: "select",
      options: [
        { label: "0.01", value: 0.01 },
        { label: "0.05", value: 0.05 },
        { label: "0.10 — Recommended", value: 0.1 },
        { label: "0.20", value: 0.2 },
        { label: "0.50", value: 0.5 },
      ],
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
    affine: {
      label: "Learnable Scale and Bias",
      type: "select",
      options: [
        { label: "Enabled", value: true },
        { label: "Disabled", value: false },
      ],
    },
  },
};

export default batchNorm2dLayer;
