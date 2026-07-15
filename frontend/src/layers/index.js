import inputLayer from "./input";
import conv1dLayer from "./conv1d";
import conv2dLayer from "./conv2d";
import conv3dLayer from "./conv3d";
import convTranspose2dLayer from "./convTranspose2d";
import maxPool2dLayer from "./maxPool2d";
import averagePool2dLayer from "./averagePool2d";
import globalAveragePool2dLayer from "./globalAveragePool2d";
import globalMaxPool2dLayer from "./globalMaxPool2d";
import adaptiveMaxPool2dLayer from "./adaptiveMaxPool2d";
import batchNorm2dLayer from "./batchNorm2d";
import layerNormLayer from "./layerNorm";
import flattenLayer from "./flatten";
import denseLayer from "./dense";
import dropoutLayer from "./dropout";
import outputLayer from "./output";

const layerTemplates = [
  inputLayer,
  conv1dLayer,
  conv2dLayer,
  conv3dLayer,
  convTranspose2dLayer,
  maxPool2dLayer,
  averagePool2dLayer,
  globalAveragePool2dLayer,
  globalMaxPool2dLayer,
  adaptiveMaxPool2dLayer,
  batchNorm2dLayer,
  layerNormLayer,
  flattenLayer,
  denseLayer,
  dropoutLayer,
  outputLayer,
];

export default layerTemplates;