const conv3dLayer = {
  type: "Conv3D",
  properties: {
    filters: 32,
    kernel_size: 3,
    stride: 1,
    padding: 1,
    dilation: 1,
    activation: "relu",
  },
  propertyConfig: {
    filters: {
      label: "Filters",
      type: "select",
      options: [8, 16, 32, 64, 128, 256].map((value) => ({
        label: `${value} Filters`,
        value,
      })),
    },
    kernel_size: {
      label: "Kernel Size",
      type: "select",
      options: [1, 3, 5].map((value) => ({
        label: `${value} × ${value} × ${value}`,
        value,
      })),
    },
    stride: {
      label: "Stride",
      type: "select",
      options: [1, 2, 3].map((value) => ({ label: `${value}`, value })),
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
    dilation: {
      label: "Dilation",
      type: "select",
      options: [
        { label: "1 — Normal Convolution", value: 1 },
        { label: "2 — Dilated ×2", value: 2 },
        { label: "3 — Dilated ×3", value: 3 },
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

export default conv3dLayer;
