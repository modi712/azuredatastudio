/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ITextModel } from 'vs/editor/common/model';
import { URI } from 'vs/base/common/uri';
import { ResourceEditorInput } from 'vs/workbench/common/editor/resourceEditorInput';
import { ResourceEditorModel } from 'vs/workbench/common/editor/resourceEditorModel';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { workbenchInstantiationService, TestServiceAccessor } from 'vs/workbench/test/browser/workbenchTestServices';
import { TextFileEditorModel } from 'vs/workbench/services/textfile/common/textFileEditorModel';
import { snapshotToString } from 'vs/workbench/services/textfile/common/textfiles';
import { TextFileEditorModelManager } from 'vs/workbench/services/textfile/common/textFileEditorModelManager';
import { Event } from 'vs/base/common/event';
import { UntitledTextEditorInput } from 'vs/workbench/services/untitled/common/untitledTextEditorInput';

suite('Workbench - TextModelResolverService', () => {

	let instantiationService: IInstantiationService;
	let accessor: TestServiceAccessor;
	let model: TextFileEditorModel;

	setup(() => {
		instantiationService = workbenchInstantiationService();
		accessor = instantiationService.createInstance(TestServiceAccessor);
	});

	teardown(() => {
		if (model) {
			model.dispose();
			model = (undefined)!;
		}
		(<TextFileEditorModelManager>accessor.textFileService.files).dispose();
	});

	test('resolve resource', async () => {
		const dispose = accessor.textModelResolverService.registerTextModelContentProvider('test', {
			provideTextContent: function (resource: URI): Promise<ITextModel> {
				if (resource.scheme === 'test') {
					let modelContent = 'Hello Test';
					let languageSelection = accessor.modeService.create('json');
					return Promise.resolve(accessor.modelService.createModel(modelContent, languageSelection, resource));
				}

				return Promise.resolve(null!);
			}
		});

		let resource = URI.from({ scheme: 'test', authority: null!, path: 'thePath' });
		let input: ResourceEditorInput = instantiationService.createInstance(ResourceEditorInput, resource, 'The Name', 'The Description', undefined);

		const model = await input.resolve();
		assert.ok(model);
		assert.equal(snapshotToString(((model as ResourceEditorModel).createSnapshot()!)), 'Hello Test');
		let disposed = false;
		let disposedPromise = new Promise<void>(resolve => {
			Event.once(model.onDispose)(() => {
				disposed = true;
				resolve();
			});
		});
		input.dispose();

		await disposedPromise;
		assert.equal(disposed, true);
		dispose.dispose();
	});

	test('resolve untitled', async () => {
		const service = accessor.untitledTextEditorService;
		const untitledModel = service.create();
		const input = instantiationService.createInstance(UntitledTextEditorInput, untitledModel);

		await input.resolve();
		const ref = await accessor.textModelResolverService.createModelReference(input.resource);
		const model = ref.object;
		assert.equal(untitledModel, model);
		const editorModel = model.textEditorModel;
		assert.ok(editorModel);
		ref.dispose();
		input.dispose();
		model.dispose();
	});

	test('even loading documents should be refcounted', async () => {
		let resolveModel!: Function;
		let waitForIt = new Promise(c => resolveModel = c);

		const disposable = accessor.textModelResolverService.registerTextModelContentProvider('test', {
			provideTextContent: async (resource: URI): Promise<ITextModel> => {
				await waitForIt;

				let modelContent = 'Hello Test';
				let languageSelection = accessor.modeService.create('json');
				return accessor.modelService.createModel(modelContent, languageSelection, resource);
			}
		});

		const uri = URI.from({ scheme: 'test', authority: null!, path: 'thePath' });

		const modelRefPromise1 = accessor.textModelResolverService.createModelReference(uri);
		const modelRefPromise2 = accessor.textModelResolverService.createModelReference(uri);

		resolveModel();

		const modelRef1 = await modelRefPromise1;
		const model1 = modelRef1.object;
		const modelRef2 = await modelRefPromise2;
		const model2 = modelRef2.object;
		const textModel = model1.textEditorModel;

		assert.equal(model1, model2, 'they are the same model');
		assert(!textModel.isDisposed(), 'the text model should not be disposed');

		modelRef1.dispose();
		assert(!textModel.isDisposed(), 'the text model should still not be disposed');

		let p1 = new Promise<void>(resolve => textModel.onWillDispose(resolve));
		modelRef2.dispose();

		await p1;
		assert(textModel.isDisposed(), 'the text model should finally be disposed');

		disposable.dispose();
	});
});
