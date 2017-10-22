import { JSX } from '../../src/renderers/JSX';
import test from 'ava';
import { dispatchInputEvent, initJsonFormsStore } from '../helpers/setup';
import { JsonSchema } from '../../src/models/jsonSchema';
import { ControlElement } from '../../src/models/uischema';
import TextControl , { textControlTester } from '../../src/renderers/controls/text.control';
import { JsonForms } from '../../src/core';
import {
  findRenderedDOMElementWithClass,
  findRenderedDOMElementWithTag,
  renderIntoDocument
} from 'inferno-test-utils';
import { update, validate } from '../../src/actions';
import { Provider } from 'inferno-redux';
import { getData } from '../../src/reducers/index';

test.before(() => {
  JsonForms.stylingRegistry.registerMany([
    {
      name: 'control',
      classNames: ['control']
    },
    {
      name: 'control.validation',
      classNames: ['validation']
    }
  ]);
});
test.beforeEach(t => {
  t.context.data =  { 'name': 'Foo' };
  t.context.schema = {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        minLength: 3
      }
    }
  };
  t.context.uischema = {
    type: 'Control',
    scope: {
      $ref: '#/properties/name'
    }
  };
});

test('tester', t => {
  t.is(textControlTester(undefined, undefined), -1);
  t.is(textControlTester(null, undefined), -1);
  t.is(textControlTester({type: 'Foo'}, undefined), -1);
  // scope is missing
  t.is(textControlTester({type: 'Control'}, undefined), -1);
});

test('render', t => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      name: { type: 'string' }
    }
  };
  const data = { 'name': 'Foo' };
  const store = initJsonFormsStore(data, schema, t.context.uischema);
  const tree = renderIntoDocument(
    <Provider store={store}>
      <TextControl schema={schema}
                   uischema={t.context.uischema}
      />
    </Provider>
  );

  const control = findRenderedDOMElementWithClass(tree, 'control');
  t.not(findRenderedDOMElementWithClass(tree, 'root_properties_name'), undefined);
  t.is(control.childNodes.length, 3);

  const label = findRenderedDOMElementWithTag(tree, 'label');
  t.is(label.textContent, 'Name');

  const input = findRenderedDOMElementWithTag(tree, 'input') as HTMLTextAreaElement;
  t.is(input.value, 'Foo');

  const validation = findRenderedDOMElementWithClass(tree, 'validation');
  t.is(validation.tagName, 'DIV');
  t.is((validation as HTMLDivElement).children.length, 0);
});

test('render without label', t => {
  const uischema: ControlElement = {
    type: 'Control',
    scope: {
      $ref: '#/properties/name'
    },
    label: false
  };
  const store = initJsonFormsStore(
    t.context.data,
    t.context.schema,
    uischema
  );
  const tree = renderIntoDocument(
    <Provider store={store}>
      <TextControl schema={t.context.schema}
                   uischema={uischema}
      />
    </Provider>
  );

  const control = findRenderedDOMElementWithClass(tree, 'control');
  t.not(control, undefined);
  t.is(control.childNodes.length, 3);

  const label = findRenderedDOMElementWithTag(tree, 'label') as HTMLLabelElement;
  t.is(label.textContent, '');

  const input = findRenderedDOMElementWithTag(tree, 'input') as HTMLInputElement;
  t.is(input.value, 'Foo');

  const validation = findRenderedDOMElementWithClass(tree, 'validation');
  t.is(validation.tagName, 'DIV');
  t.is((validation as HTMLDivElement).children.length, 0);
});

test('update via input event', t => {
  const store = initJsonFormsStore(
    t.context.data,
    t.context.schema,
    t.context.uischema
  );
  const tree = renderIntoDocument(
    <Provider store={store}>
      <TextControl schema={t.context.schema}
                   uischema={t.context.uischema}
      />
    </Provider>
  );

  const input = findRenderedDOMElementWithTag(tree, 'input') as HTMLInputElement;
  input.value = 'Bar';
  dispatchInputEvent(input);
  t.is(getData(store.getState()).name, 'Bar');
});

test('update via action', t => {
  const store = initJsonFormsStore(
    t.context.data,
    t.context.schema,
    t.context.uischema
  );
  const tree = renderIntoDocument(
    <Provider store={store}>
      <TextControl schema={t.context.schema}
                   uischema={t.context.uischema}
      />
    </Provider>
  );
  const input = findRenderedDOMElementWithTag(tree, 'input') as HTMLInputElement;
  store.dispatch(update('name', () => 'Bar'));
  t.is(input.value, 'Bar');
});

test('update with undefined value', t => {
  const store = initJsonFormsStore(
    t.context.data,
    t.context.schema,
    t.context.uischema
  );
  const tree = renderIntoDocument(
    <Provider store={store}>
      <TextControl schema={t.context.schema}
                   uischema={t.context.uischema}
      />
    </Provider>
  );
  const input = findRenderedDOMElementWithTag(tree, 'input') as HTMLTextAreaElement;
  store.dispatch(update('name', () => undefined));
  t.is(input.value, '');
});

test('update with null value', t => {
  const store = initJsonFormsStore(
    t.context.data,
    t.context.schema,
    t.context.uischema
  );
  const tree = renderIntoDocument(
    <Provider store={store}>
      <TextControl schema={t.context.schema}
                   uischema={t.context.uischema}
      />
    </Provider>
  );
  const input = findRenderedDOMElementWithTag(tree, 'input') as HTMLTextAreaElement;
  store.dispatch(update('name', () => null));
  t.is(input.value, '');
});

test('update with wrong ref', t => {
  const store = initJsonFormsStore(
    t.context.data,
    t.context.schema,
    t.context.uischema
  );
  const tree = renderIntoDocument(
    <Provider store={store}>
      <TextControl schema={t.context.schema}
                   uischema={t.context.uischema}
      />
    </Provider>
  );
  const input = findRenderedDOMElementWithTag(tree, 'input') as HTMLTextAreaElement;
  store.dispatch(
    update(
      'firstname',
      () => 'Bar'
    )
  );
  t.is(input.value, 'Foo');
});

test('update with null ref', t => {
  const store = initJsonFormsStore(
    t.context.data,
    t.context.schema,
    t.context.uischema
  );
  const tree = renderIntoDocument(
    <Provider store={store}>
      <TextControl schema={t.context.schema}
                   uischema={t.context.uischema}
      />
    </Provider>
  );
  const input = findRenderedDOMElementWithTag(tree, 'input') as HTMLTextAreaElement;
  store.dispatch(
    update(
      null,
      () => 'Bar'
    )
  );
  t.is(input.value, 'Foo');
});

test('update with undefined ref', t => {
  const store = initJsonFormsStore(
    t.context.data,
    t.context.schema,
    t.context.uischema
  );
  const tree = renderIntoDocument(
    <Provider store={store}>
      <TextControl schema={t.context.schema}
                   uischema={t.context.uischema}
      />
    </Provider>
  );
  const input = findRenderedDOMElementWithTag(tree, 'input') as HTMLTextAreaElement;
  store.dispatch(
    update(
      undefined,
      () => 'Bar'
    )
  );
  t.is(input.value, 'Foo');
});

test('hide', t => {
  const store = initJsonFormsStore(t.context.data, t.context.schema, t.context.uischema);
  const tree = renderIntoDocument(
    <Provider store={store}>
      <TextControl schema={t.context.schema}
                   uischema={t.context.uischema}
                   visible={false}
      />
    </Provider>
  );
  const input = findRenderedDOMElementWithTag(tree, 'input') as HTMLInputElement;
  t.true(input.hidden);
});

test('show by default', t => {
  const store = initJsonFormsStore(
    t.context.data,
    t.context.schema,
    t.context.uischema
  );
  const tree = renderIntoDocument(
    <Provider store={store}>
      <TextControl schema={t.context.schema}
                   uischema={t.context.uischema}
      />
    </Provider>
  );
  const input = findRenderedDOMElementWithTag(tree, 'input') as HTMLInputElement;
  t.false(input.hidden);
});

test('disable', t => {
  const store = initJsonFormsStore(
    t.context.data,
    t.context.schema,
    t.context.uischema
  );
  const tree = renderIntoDocument(
    <Provider store={store}>
      <TextControl schema={t.context.schema}
                   uischema={t.context.uischema}
                   enabled={false}
      />
    </Provider>
  );
  const input = findRenderedDOMElementWithTag(tree, 'input') as HTMLInputElement;
  t.true(input.disabled);
});

test('enabled by default', t => {
  const store = initJsonFormsStore(t.context.data, t.context.schema, t.context.uischema);
  const tree = renderIntoDocument(
    <Provider store={store}>
      <TextControl schema={t.context.schema}
                   uischema={t.context.uischema}
      />
    </Provider>
  );
  const input = findRenderedDOMElementWithTag(tree, 'input') as HTMLInputElement;
  t.false(input.disabled);
});

test('single error', t => {
  const store = initJsonFormsStore(
    t.context.data,
    t.context.schema,
    t.context.uischema
  );
  const tree = renderIntoDocument(
    <Provider store={store}>
      <TextControl schema={t.context.schema}
                   uischema={t.context.uischema}

      />
    </Provider>
  );
  const validation = findRenderedDOMElementWithClass(tree, 'validation');
  store.dispatch(update('name', () => 'a'));
  store.dispatch(validate());
  t.is(validation.textContent, 'should NOT be shorter than 3 characters');
});

test('multiple errors', t => {
  const schema = {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        minLength: 3,
        enum: ['foo', 'bar']
      }
    }
  };
  const store = initJsonFormsStore(t.context.data, schema, t.context.uischema);
  const tree = renderIntoDocument(
    <Provider store={store}>
      <TextControl schema={t.context.schema}
                   uischema={t.context.uischema}

      />
    </Provider>
  );
  const validation = findRenderedDOMElementWithClass(tree, 'validation');
  store.dispatch(update('name', () => 'a'));
  store.dispatch(validate());
  t.is(
    validation.textContent,
    'should NOT be shorter than 3 characters\nshould be equal to one of the allowed values'
  );
});

test('empty errors by default', t => {
  const store = initJsonFormsStore(
    t.context.data,
    t.context.schema,
    t.context.uischema
  );
  const tree = renderIntoDocument(
    <Provider store={store}>
      <TextControl schema={t.context.schema}
                   uischema={t.context.uischema}

      />
    </Provider>
  );
  const validation = findRenderedDOMElementWithClass(tree, 'validation');
  t.is(validation.textContent, '');
});

test('reset validation message', t => {
  const store = initJsonFormsStore(
    t.context.data,
    t.context.schema,
    t.context.uischema
  );
  const tree = renderIntoDocument(
    <Provider store={store}>
      <TextControl schema={t.context.schema}
                   uischema={t.context.uischema}

      />
    </Provider>
  );
  const validation = findRenderedDOMElementWithClass(tree, 'validation');
  store.dispatch(update('name', () => 'a'));
  store.dispatch(update('name', () => 'aaa'));
  store.dispatch(validate());
  t.is(validation.textContent, '');
});
