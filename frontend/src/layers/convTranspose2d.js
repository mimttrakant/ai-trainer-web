const convTranspose2dLayer = {
  type: "ConvTranspose2D",
  properties: {
    filters: 32,
    kernel_size: 3,
    stride: 2,
    padding: 1,
    output_padding: 1,
    activation: "relu",
  },
  propertyConfig: {
    filters: {
      label: "Filters",
      type: "select",
      options: [8, 16, 32, 64, 128, 256, 512].map((value) => ({
        label: `${value} Filters`,
        value,
      })),
    },
    kernel_size: {
      label: "Kernel Size",
      type: "select",
      options: [2, 3, 4, 5].map((value) => ({
        label: `${value} × ${value}`,
        value,
      })),
    },
    stride: {
      label: "Stride",
      type: "select",
      options: [1, 2, 3, 4].map((value) => ({ label: `${value}`, value })),
    },
    padding: {
      label: "Padding",
      type: "select",
      options: [
        { label: "0 — No Padding", value: 0 },
        { label: "1", value: 1 },
        { label: "2", value: 2 },
      ],
    },
    output_padding: {
      label: "Output Padding",
      type: "select",
      options: [
        { label: "0", value: 0 },
        { label: "1", value: 1 },
        { label: "2", value: 2 },
      ],
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

export default convTranspose2dLayer;
