const globalMaxPool2dLayer = {
  type: "GlobalMaxPool2D",
  properties: {},
  propertyConfig: {
    information: {
      label: "Information",
      type: "label",
      text: "Selects the maximum value from each feature map and converts every channel into one value.",
    },
  },
};

export default globalMaxPool2dLayer;
