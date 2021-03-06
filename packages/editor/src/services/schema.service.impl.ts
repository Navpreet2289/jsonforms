/* tslint:disable:max-file-line-count */
import * as AJV from 'ajv';
import * as _ from 'lodash';
import { JsonSchema } from '@jsonforms/core';
import { resolveSchema } from '@jsonforms/core';
import {
  ContainmentProperty,
  ContainmentPropertyImpl,
  ReferenceProperty,
  ReferencePropertyImpl,
  SchemaService
} from './schema.service';
import * as uuid from 'uuid';
import { resolveLocalData } from '../helpers/util';
import { RS_PROTOCOL } from '../resources/resource-set';
import { Resources } from '../resources/resources';
import { ModelMapping } from '../helpers/containment.util';
import { EditorContext } from '../editor-context';
import * as JsonRefs from 'json-refs';

const ajv = new AJV({ jsonPointers: true });

const isObject = (schema: JsonSchema): boolean => {
  return schema.properties !== undefined;
};
const isArray = (schema: JsonSchema): boolean => {
  return schema.items !== undefined;
};
const deepCopy = <T>(object: T): T => {
  return JSON.parse(JSON.stringify(object)) as T;
};
/**
 * Validates the given data against the given JSON Schema.
 *
 * @return true if the data adheres to the schema, false otherwise
 */
const checkData = (data: Object, targetSchema: JsonSchema): boolean => {
  // use AJV to validate data against targetSchema and return result
  return ajv.validate(targetSchema, data);
};

const addToArray =
  (key: string, identifyingProperty?: string) =>
    (data: Object) =>
      (valueToAdd: object, neighbourValue?: object, insertAfter = true) => {
        if (data[key] === undefined) {
          data[key] = [];
        }
        if (!_.isEmpty(identifyingProperty) && _.isEmpty(valueToAdd[identifyingProperty])) {
          valueToAdd[identifyingProperty] = uuid.v4();
        }
        const childArray = data[key];
        if (neighbourValue !== undefined && neighbourValue !== null) {
          const index = childArray.indexOf(neighbourValue) as number;
          if (insertAfter) {
            if (index >= 0 && index < (childArray.length - 1)) {
              childArray.splice(index + 1, 0, valueToAdd);

              return;
            }
            console.warn('Could not add the new value after the given neighbour value. ' +
              'The new value was added at the end.');
          } else {
            if (index >= 0) {
              childArray.splice(index, 0, valueToAdd);

              return;
            }
            console.warn('The given neighbour value could not be found. ' +
              'The new value was added at the end.');
          }
        }
        // default behavior: add at the end
        childArray.push(valueToAdd);

      };
const deleteFromArray = (key: string) => (data: object) => (valueToDelete: object) => {
  const childArray = data[key];
  if (!childArray) {
    return;
  }
  const indexToDelete = childArray.indexOf(valueToDelete);
  childArray.splice(indexToDelete, 1);
};
const getArray = (key: string) => (data: object) => {
  return data[key];
};
const addReference = (schema: JsonSchema, identifyingProperty: string, propName: string) =>
  (data: Object, toAdd: object) => {

    const refValue = toAdd[identifyingProperty];
    if (schema.properties[propName].type === 'array') {
      if (!data[propName]) {
        data[propName] = [];
      }
      data[propName].push(refValue);
    } else {
      data[propName] = refValue;
    }
  };

/**
 * Retrieves the data that contains the reference targets by resolving the given href uri.
 * Thereby, the root data is gathered based on the protocol and then resolved
 * against the uri's path.
 *
 * Important: This method does not resolve the actual reference targets but only the
 * root data containing them.
 *
 * @return the resolved data containing the reference targets; {null} if the href cannot be resolved
 */
const getReferenceTargetData = (data: Object, href: string): Object => {
  let rootData: Object;
  let localTemplatePath: string;
  if (_.startsWith(href, RS_PROTOCOL)) {
    const resourceName = href.substring(RS_PROTOCOL.length).split('/')[0];
    localTemplatePath = href.substring(RS_PROTOCOL.length + resourceName.length + 1);
    rootData = Resources.resourceSet.getResource(resourceName);
    // reference to data in resource set
  } else if (_.startsWith(href, 'http://')) {
    // remote data
    console.warn(`Remote data resolution is not yet implemented for data links.`);

    return null;
  } else if (_.startsWith(href, '#') || (href.match(/\{.*\}/) !== null)) {
    // local data
    rootData = data;
    localTemplatePath = href;
  } else {
    console.error(`'${href}' is not a supported URI to specify reference targets in a link block.`);

    return {};
  }
  const localPath = localTemplatePath.split(/\/\{.*\}/)[0];
  if (localPath.match(/\{.*\}/) !== null) {
    // the local path only contains the template variable
    return rootData;
  }

  return resolveLocalData(rootData, localPath);
};

// reference resolvement for id based references
const resolveRef = (schema: JsonSchema, findTargets: (data: Object) => { [key: string]: Object },
                    propName: string) => (data: Object): { [key: string]: Object } => {
    if (_.isEmpty(data)) {
      return {};
    }
    // get all objects that could be referenced.
    const candidates = findTargets(data);
    const result = {};
    if (_.isEmpty(schema.properties[propName].type)) {
      throw Error(`The schema of the property '${propName}' does not specify a schema type.`);
    }
    if (schema.properties[propName].type === 'array') {
      const ids = data[propName] as string[];

      // check that there is at most one reference target for every id
      for (const id of ids) {
        const idResult = candidates[id];
        if (idResult === undefined) {
          console.warn(`Could not resolve the referenced data for id '${id}'.`);
          continue;
        }
        result[id] = idResult;
      }
    } else {
      // use identifying property to identify the referenced object
      const id = data[propName];
      const idResult = candidates[id];
      if (idResult === undefined) {
        console.warn(`Could not resolve the referenced data for id '${id}'.`);

        return result;
      }
      result[id] = idResult;
    }

    return result;
  };

const getFindReferenceTargetsFunction =
  (href: string, schemaId: string, idProp: string, modelMapping?: ModelMapping) =>
    (data: Object): { [key: string]: Object } => {
      const candidates = getReferenceTargetData(data, href) as Object[];
      if (!_.isEmpty(candidates)) {
        const result = {};
        for (const candidate of filterObjectsByType(candidates, schemaId, modelMapping)) {
          const id = candidate[idProp];
          result[id] = candidate;
        }

        return result;
      }

      return {};
    };

/**
 * Recursive method to find all paths to valid reference targets based on the
 * target schema identifying them.
 * This method searches the target based on the given data and calculates the path
 * based on the current location and adding the next path segment for child properties
 * or array elements.
 *
 * The result is an object mapping from the found paths to the target data object
 * found at the path.
 */
const collectionHelperMap = (currentPath: string, data: Object, targetSchema: JsonSchema)
  : { [key: string]: Object } => {
  const result = {};
  if (checkData(data, targetSchema)) {
    // must be done before null check before null might be a valid target
    result[currentPath] = data;
  }
  if (data === undefined || data === null) {
    return result;
  }
  if (Array.isArray(data)) {
    // TODO how to deal with array? index? - assume index for now
    for (let i = 0; i < data.length; i++) {
      const childPath = _.isEmpty(currentPath) ? `${i}` : `${currentPath}/${i}`;
      const childResult = collectionHelperMap(childPath, data[i], targetSchema);
      _.assign(result, childResult);
    }
  } else if (!_.isEmpty(data) && typeof data !== 'string') {
    Object.keys(data).forEach(key => {
      // NOTE later maybe need to check for refs and thereby circles
      const childPath = _.isEmpty(currentPath) ? key : `${currentPath}/${key}`;
      const childResult = collectionHelperMap(childPath, data[key], targetSchema);
      _.assign(result, childResult);
    });
  }

  return result;
};

/**
 * Adds the reference path given in toAdd to the data's reference property.
 */
const addPathBasedRef = (schema: JsonSchema, propName: string) =>
  (data: Object, toAdd: object) => {
    if (typeof toAdd !== 'string') {
      console.error(`Path based reference values must be of type string. The given value was of`
        + ` type '${typeof toAdd}' and could not be added.`);

      return;
    }

    // const refValue = toAdd[identifyingProperty];
    if (schema.properties[propName].type === 'array') {
      if (!data[propName]) {
        data[propName] = [];
      }
      data[propName].push(toAdd);
    } else {
      data[propName] = toAdd;
    }
  };

const resolvePathBasedRef = (href: string, pathProperty: string) => (data: Object)
  : { [key: string]: Object } => {
  const targetData = getReferenceTargetData(data, href);
  const paths = data[pathProperty];
  const result = {};
  if (Array.isArray(paths)) {
    for (const path of paths) {
      const curRes = resolveLocalData(targetData, path);
      result[path] = curRes;
    }
  } else {
    result[paths] = resolveLocalData(targetData, paths);
  }

  return result;
};

const getPathBasedRefTargets = (href: string, targetSchema: JsonSchema) => (data: Object)
  : { [key: string]: Object } => {
  const targetData = getReferenceTargetData(data, href);

  if (href.indexOf('#') > -1) {
    return collectionHelperMap('', targetData, targetSchema);
  }

  return collectionHelperMap('#', targetData, targetSchema);
};

/**
 * Uses the model mapping to filter all objects that are associated with the type
 * defined by the given schema id. If there is no applicable mapping,
 * we assume that no mapping is necessary and do not filter out affected data objects.
 *
 * @param objects the list of data objects to filter
 * @param schemaId The id of the JsonSchema defining the type to filter for
 * @return The filtered data objects or all objects if there is no applicable mapping
 */
const filterObjectsByType =
  (objects: Object[], schemaId: string, modelMapping?: ModelMapping): Object[] => {
    // No filtering possible without a mapping, return all
    if (modelMapping === undefined) {
      return objects;
    }

    return objects.filter(value => {
      const valueSchemaId = getSchemaIdForObject(value, modelMapping);
      if (valueSchemaId === null) {
        return true;
      }

      return valueSchemaId === schemaId;
    });
  };

/**
 * Uses the model mapping to find the schema id defining the type of the given object.
 * If no schema id can be determined either because the object is empty, there is no model
 * mapping, or the object does not contain a mappable property.
 * TODO expected behavior?
 *
 * @param object The object whose type is determined
 * @return The schema id of the object or null if it could not be determined
 */
const getSchemaIdForObject = (object: Object, modelMapping: ModelMapping): string => {
  if (modelMapping !== undefined && !_.isEmpty(object)) {
    const mappingAttribute = modelMapping.attribute;
    if (!_.isEmpty(mappingAttribute)) {
      const mappingValue = object[mappingAttribute];
      const schemaElementId: string = modelMapping.mapping[mappingValue];

      return !_.isEmpty(schemaElementId) ? schemaElementId : null;
    }
  }

  return null;
};

/**
 * Interface for describing result of an extracted schema ref
 */
interface SchemaRef {
  uri: string;
}

/**
 * Interface wraps SchemaRef
 */
interface SchemaRefs {
  [id: string]: SchemaRef;
}

/**
 * Finding required definitions from parentSchema by using schema refs
 *
 * @param parentSchema The root schema
 * @param allRefs All the refs of root schema
 * @param schemaRefs The current schema refs
 * @param extractedReferences Contains the definition attributes for the current schema
 * @returns SchemaRefs all the required reference paths for subschema
 */
const findReferencePaths = (parentSchema: JsonSchema,
                            allRefs: SchemaRefs,
                            schemaRefs: SchemaRefs,
                            extractedReferences: { [id: string]: string }
): SchemaRefs => {
  return _.reduce(
    schemaRefs, (prev, schemaRefValue)  => {
    let refs = _.pickBy(prev, _.flip(key => _.startsWith(key, schemaRefValue.uri)));
    if (extractedReferences[schemaRefValue.uri]) {
      refs = undefined;
    }
    if (!extractedReferences[schemaRefValue.uri]) {
      extractedReferences[schemaRefValue.uri] = schemaRefValue.uri;
      prev = _.omitBy(prev, value => value.uri === schemaRefValue.uri);
    }
    if (refs !== undefined) {
      findReferencePaths(parentSchema, prev, refs, extractedReferences);
    }
    return prev;
  },
    allRefs
  );
};

/**
 * Calculate references that are used in parentSchema and add copy them into schema
 *
 * @param parentSchema root schema which is used to find all the schema refs
 * @param schema current subschema without resolved references
 * @returns JsonSchema current subschema with resolved references
 */
export const calculateSchemaReferences = (parentSchema: JsonSchema,
                                          schema: JsonSchema): JsonSchema => {
  const schemaRefs = JsonRefs.findRefs(schema, {resolveCirculars: true});
  const allRefs = JsonRefs.findRefs(parentSchema, {resolveCirculars: true});
  const extractedReferences = {};
  findReferencePaths(parentSchema, allRefs, schemaRefs, extractedReferences);
  const refList = _.values(extractedReferences) as string[];
  if (!_.isEmpty(refList)) {
    _.each(refList, ref => {
      const propertyRoot = ref.substring((ref.indexOf('/') + 1), (ref.lastIndexOf('/')));
      const property = ref.substring((ref.lastIndexOf('/') + 1));
      if (parentSchema[propertyRoot] && parentSchema[propertyRoot][property]) {
        if (schema[propertyRoot]) {
          schema[propertyRoot] = {
            ...schema[propertyRoot], ...{
              [property]: parentSchema[propertyRoot][property]
            }
          };
        } else {
          schema = {
            ...schema, ...{
              [propertyRoot]: { [property]: parentSchema[propertyRoot][property] }
            }
          };
        }
      }
    });
  }

  return schema;
};

export class SchemaServiceImpl implements SchemaService {
  private selfContainedSchemas: { [id: string]: JsonSchema } = {};

  constructor(private editorContext: EditorContext) {
    if (_.isEmpty(editorContext.dataSchema.id)) {
      editorContext.dataSchema.id = '#generatedRootID';
    }
    this.selfContainedSchemas[editorContext.dataSchema.id] = this.editorContext.dataSchema;
  }

  getContainmentProperties(schema: JsonSchema): ContainmentProperty[] {
    return this.getContainment('root', 'root', schema,
                               this.editorContext.dataSchema, false, null, null, null);
  }

  hasContainmentProperties(schema: JsonSchema): boolean {
    return this.getContainmentProperties(schema).length !== 0;
  }
  getSelfContainedSchema(parentSchema: JsonSchema, refPath: string): JsonSchema {
    let schema = resolveSchema(parentSchema, refPath);
    schema = deepCopy(schema);
    if (_.isEmpty(schema.id)) {
      schema.id = '#' + refPath;
    }
    if (this.selfContainedSchemas.hasOwnProperty(schema.id)) {
      return this.selfContainedSchemas[schema.id];
    }
    schema = { ...schema, ...calculateSchemaReferences(parentSchema, schema) };
    this.selfContainedSchemas[schema.id] = schema;

    return schema;
  }

  getReferenceProperties(schema: JsonSchema): ReferenceProperty[] {
    if (schema.$ref !== undefined) {
      return this.getReferenceProperties(
        this.getSelfContainedSchema(this.editorContext.dataSchema, schema.$ref));
    }
    // tslint:disable:no-string-literal
    if (schema['links']) {
      const links = schema['links'];
      // tslint:enable:no-string-literal
      const result: ReferenceProperty[] = [];
      links.forEach(link => {
        if (_.isEmpty(link.targetSchema) || _.isEmpty(link.href)) {
          console.warn(`Could not create link property because the configuration was invalid`,
                       link);

          return;
        }
        let targetSchema;
        // TODO what if schema is url but not resolved?
        if (link.targetSchema.$ref !== undefined) {
          targetSchema = this.getSelfContainedSchema(this.editorContext.dataSchema,
                                                     link.targetSchema.$ref);
        } else if (link.targetSchema.resource !== undefined) {
          const resSchema = Resources.resourceSet.getResource(link.targetSchema.resource);
          if (resSchema === undefined) {
            console.error(`Could not find target schema: There is no resource with name:` +
              `${link.targetSchema.resource}`);

            return [];
          }
          targetSchema = resSchema;
        } else {
          targetSchema = link.targetSchema;
        }

        const href: string = link.href;
        const variableWrapped = href.match(/\{.*\}/)[0];
        const variable = variableWrapped.substring(1, variableWrapped.length - 1);

        let findRefTargets: (data: Object) => { [key: string]: Object };
        let resolveReference: (data: Object) => { [key: string]: Object };
        let addToReference: (data: Object, toAdd: object) => void;
        let idBased: boolean;

        // assume targetSchema is resolved
        if (!_.isEmpty(this.editorContext.identifyingProperty) && !_.isEmpty(targetSchema.id)
          && !_.isEmpty(targetSchema.properties)
          && !_.isEmpty(targetSchema.properties[this.editorContext.identifyingProperty])) {
          // use id based referencing & reuse existing code for now
          // TODO reuse of existing id behavior sub-optimal (does not search cascaded)
          idBased = true;
          const schemaId = targetSchema.id as string;
          findRefTargets = getFindReferenceTargetsFunction(href, schemaId,
                                                           this.editorContext.identifyingProperty,
                                                           this.editorContext.modelMapping);
          resolveReference = resolveRef(schema, findRefTargets, variable);
          addToReference = addReference(schema, this.editorContext.identifyingProperty, variable);
        } else {
          // use path based referencing
          idBased = false;
          findRefTargets = getPathBasedRefTargets(href, targetSchema);
          resolveReference = resolvePathBasedRef(href, variable);
          addToReference = addPathBasedRef(schema, variable);
        }

        result.push(
          new ReferencePropertyImpl(
            schema.properties[variable],
            targetSchema,
            variable,
            variable,
            idBased,
            findRefTargets,
            addToReference,
            resolveReference
          )
        );
      });

      return result;
    }
    if (schema.anyOf !== undefined) {
      return schema.anyOf.reduce((prev, cur) => prev.concat(this.getReferenceProperties(cur)), []);
    }

    return [];
  }

  private getContainment(key: string, name: string, schema: JsonSchema, rootSchema: JsonSchema,
                         isInContainment: boolean,
                         addFunction: (data: object) => (valueToAdd: object,
                                                         neighbourValue?: object,
                                                         insertAfter?: boolean) => void,
                         deleteFunction: (data: object) => (valueToDelete: object) => void,
                         getFunction: (data: object) => Object,
                         internal = false
  ): ContainmentProperty[] {
    if (schema.$ref !== undefined) {
      return this.getContainment(
        key,
        schema.$ref === '#' ? undefined : schema.$ref.substring(schema.$ref.lastIndexOf('/') + 1),
        this.getSelfContainedSchema(rootSchema, schema.$ref),
        rootSchema,
        isInContainment,
        addFunction,
        deleteFunction,
        getFunction,
        internal
      );
    }
    if (isObject(schema)) {
      if (isInContainment) {

        return [new ContainmentPropertyImpl(schema, key, name, addFunction, deleteFunction,
                                            getFunction)];
      }
      if (internal) {
        // If internal is true the schema service does not need to resolve further,
        // because only directly contained containments are wanted.
        // This prevents running into circles
        return [];
      }

      return Object.keys(schema.properties)
        .reduce(
        (prev, cur) =>
          prev.concat(
            this.getContainment(
              cur,
              cur,
              schema.properties[cur],
              rootSchema,
              false,
              addFunction,
              deleteFunction,
              getFunction,
              true
            )
          ),
        []
        );
    }
    if (isArray(schema) && !Array.isArray(schema.items)) {
      return this.getContainment(
        key,
        name,
        schema.items,
        rootSchema,
        true,
        addToArray(key, this.editorContext.identifyingProperty),
        deleteFromArray(key),
        getArray(key),
        internal
      );
    }
    if (schema.anyOf !== undefined) {
      return schema.anyOf
        .reduce(
        (prev, cur) =>
          prev.concat(
            this.getContainment(
              key,
              undefined,
              cur,
              rootSchema,
              isInContainment,
              addFunction,
              deleteFunction,
              getFunction,
              internal
            )
          ),
        []
        );
    }

    return [];
  }
}
