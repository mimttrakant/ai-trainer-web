const averagePool2dLayer = {
  type: "AveragePool2D",
  properties: {
    pool_size: 2,
    stride: 2,
    padding: 0,
  },
  propertyConfig: {
    pool_size: {
      label: "Pool Size",
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
  },
};

export default averagePool2dLayer;
