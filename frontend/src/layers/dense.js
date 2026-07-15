const denseLayer = {
  type: "Dense",
  properties: {
    units: 128,
    activation: "relu",
  },
  propertyConfig: {
    units: {
      label: "Units",
      type: "select",
      options: [16, 32, 64, 128, 256, 512, 1024, 2048].map((value) => ({
        label: `${value} Units`,
        value,
      })),
    },
    activation: {
      label: "Activation",
      type: "select",
      options: [
        { label: "ReLU", value: "relu" },
        { label: "Leaky ReLU", value: "leaky_relu" },
        { label: "GELU", value: "gelu" },
        { label: "SiLU / Swish", value: "silu" },
        { label: "Sigmoid", value: "sigmoid" },
        { label: "Tanh", value: "tanh" },
        { label: "None", value: "none" },
      ],
    },
  },
};

export default denseLayer;
