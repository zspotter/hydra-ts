import { Texture2D } from 'regl';
import { TransformApplication } from '../GlslSource';
import { formatArguments } from './formatArguments';
import { contains } from './contains';
import { shaderString } from './shaderString';
import { ShaderParams } from '../compileGlsl';

export type GlslGenerator = (uv: string) => string;

export function generateGlsl(
  transforms: TransformApplication[],
  shaderParams: ShaderParams,
): GlslGenerator {
  let fragColor: GlslGenerator = () => '';

  transforms.forEach((transform) => {
    let f1:
      | ((uv: string) => string)
      | (() =>
          | string
          | number
          | number[]
          | ((context: any, props: any) => number | number[])
          | Texture2D
          | undefined);
    const inputs = formatArguments(transform, shaderParams.uniforms.length);

    inputs.forEach((input) => {
      if (input.isUniform) {
        shaderParams.uniforms.push(input);
      }
    });

    // add new glsl function to running list of functions
    if (!contains(transform, shaderParams.glslFunctions)) {
      shaderParams.glslFunctions.push(transform);
    }

    // current function for generating frag color shader code
    const f0 = fragColor;
    if (transform.transform.type === 'src') {
      fragColor = (uv) =>
        `${shaderString(uv, transform.name, inputs, shaderParams)}`;
    } else if (transform.transform.type === 'coord') {
      fragColor = (uv) =>
        `${f0(`${shaderString(uv, transform.name, inputs, shaderParams)}`)}`;
    } else if (transform.transform.type === 'color') {
      fragColor = (uv) =>
        `${shaderString(`${f0(uv)}`, transform.name, inputs, shaderParams)}`;
    } else if (transform.transform.type === 'combine') {
      // combining two generated shader strings (i.e. for blend, mult, add funtions)
      f1 =
        inputs[0].value && inputs[0].value.transforms
          ? (uv: string) =>
              `${generateGlsl(inputs[0].value.transforms, shaderParams)(uv)}`
          : inputs[0].isUniform
          ? () => inputs[0].name
          : () => inputs[0].value;
      fragColor = (uv) =>
        `${shaderString(
          `${f0(uv)}, ${f1(uv)}`,
          transform.name,
          inputs.slice(1),
          shaderParams,
        )}`;
    } else if (transform.transform.type === 'combineCoord') {
      // combining two generated shader strings (i.e. for modulate functions)
      f1 =
        inputs[0].value && inputs[0].value.transforms
          ? (uv: string) =>
              `${generateGlsl(inputs[0].value.transforms, shaderParams)(uv)}`
          : inputs[0].isUniform
          ? () => inputs[0].name
          : () => inputs[0].value;
      fragColor = (uv) =>
        `${f0(
          `${shaderString(
            `${uv}, ${f1(uv)}`,
            transform.name,
            inputs.slice(1),
            shaderParams,
          )}`,
        )}`;
    }
  });
  return fragColor;
}