import {
  OPERATION_DEFINITION,
  DOCUMENT,
  SELECTION_SET,
  NAME,
  ARGUMENT,
  VARIABLE,
  NAMED_TYPE,
  FIELD,
  VARIABLE_DEFINITION,
  LIST_TYPE,
  NON_NULL_TYPE
} from 'graphql/language/kinds';
import {TypeKind} from 'graphql/type/introspection';
import {SET_VARIABLES} from './normalize/duck';
import denormalizeStore from './normalize/denormalizeStore';
import parseAndInitializeQuery from './query/parseAndInitializeQuery';
import {parse} from './utils';

const {LIST, NON_NULL} = TypeKind;

export class CachedMutation {
  constructor() {
    this.fullMutation = undefined;
    this.activeComponentsObj = {};
    this.variableEnhancers = [];
    this.variableSet = new Set();
    this.singles = {};
  }
  clear(clearSingles) {
    this.fullMutation = undefined;
    this.variableEnhancers = [];
    this.variableSet.clear();
    if (clearSingles) {
      this.singles = {};
    }
  }
}

export class CachedSubscription {
  constructor(subscriptionString) {
    this.ast = parse(subscriptionString);
    this.response = {};
  }
}

export class CachedQuery {
  constructor(queryString, schema, idFieldName, refetch) {
    this.ast = parseAndInitializeQuery(queryString, schema, idFieldName);
    this.refetch = refetch;
    this.response = {};
  }

  /**
   * create a denormalized document from local data
   * it also turns frags to inline, and flags missing objects and variableDefinitions in context.operation
   * the response also contains isComplete and firstRun booleans.
   * isComplete is true if the request is resolved locally
   * firstRun is true if the none of the queries within the request have been executed before
   */
  createResponse(context, component, key, dispatch, getState, forceFetch) {
    const {data, firstRun} = denormalizeStore(context);
    const response = {
      data,
      firstRun,
      isComplete: forceFetch === undefined ? true : !forceFetch && !context.operation.sendToServer,
      setVariables: this.setVariablesFactory(component, key, dispatch, getState)
    };
    if (!key) {
      this.response = response;
    } else {
      this.response[key] = response;
    }
  }

  setVariablesFactory(component, key, dispatch, getState) {
    return cb => {
      let stateVariables;
      if (key) {
        this.response.key = undefined;
        const currentVariables = getState().data.variables[component][key];
        const variables = Object.assign({}, currentVariables, cb(currentVariables));
        stateVariables = {[component]: {[key]: variables}};
      } else {
        this.response = undefined;
        const currentVariables = getState().data.variables[component];
        const variables = Object.assign({}, currentVariables, cb(currentVariables));
        stateVariables = {[component]: variables};
      }

      // use dispatch to trigger a recompute.
      dispatch({
        type: SET_VARIABLES,
        payload: {
          variables: stateVariables
        }
      });
    }
  }
}

class SelectionSet {
  constructor(selections = []) {
    this.kind = SELECTION_SET;
    this.selections = selections;
  }
}

export class Name {
  constructor(value) {
    this.kind = NAME;
    this.value = value;
  }
}

export class Field {
  constructor({alias, args, directives, name, selections}) {
    this.kind = FIELD;
    this.alias = alias;
    this.arguments = args;
    this.directives = directives;
    this.name = new Name(name);
    this.selectionSet = selections ? new SelectionSet(selections) : null;
  }
}
export class MutationShell {
  constructor(mutationName, mutationArgs, variableDefinitions = [], isEmpty) {
    this.kind = DOCUMENT;
    this.definitions = [{
      kind: OPERATION_DEFINITION,
      operation: 'mutation',
      variableDefinitions,
      directives: [],
      selectionSet: isEmpty ? null : new SelectionSet([new Field({
        args: mutationArgs,
        name: mutationName,
        selections: []
      })])
    }]
  }
}

export class RequestArgument {
  constructor(nameValue, valueKind, valueValue) {
    this.kind = ARGUMENT;
    this.name = new Name(nameValue);
    this.value = {
      kind: valueKind
    };
    if (valueKind === VARIABLE) {
      this.value.name = new Name(valueValue);
    } else {
      this.value.value = valueValue
    }
  }
}

export class VariableDefinition {
  constructor(variableName, argType) {
    this.kind = VARIABLE_DEFINITION;
    this.type = processArgType(argType);
    this.variable = {
      kind: VARIABLE,
      name: new Name(variableName)
    }
  }
}

const processArgType = argType => {
  const vardefType = {};
  if (argType.kind === NON_NULL) {
    vardefType.kind = NON_NULL_TYPE;
    vardefType.type = processArgType(argType.ofType);
  } else if (argType.kind === LIST) {
    vardefType.kind = LIST_TYPE;
    vardefType.type = processArgType(argType.ofType);
  } else {
    vardefType.kind = NAMED_TYPE;
    vardefType.name = new Name(argType.name)
  }
  return vardefType;
}
