/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as utils from '../common/utils';
import * as azureFunctionUtils from '../common/azureFunctionsUtils';
import * as constants from '../common/constants';
import * as azureFunctionsContracts from '../contracts/azureFunctions/azureFunctionsContracts';
import { AddSqlBindingParams, BindingType, GetAzureFunctionsParams, GetAzureFunctionsResult, ResultStatus } from 'sql-bindings';

export const hostFileName: string = 'host.json';


export async function createAzureFunction(connectionString: string, schema: string, table: string): Promise<void> {
	const azureFunctionApi = await azureFunctionUtils.getAzureFunctionsExtensionApi();
	if (!azureFunctionApi) {
		return;
	}
	let projectFile = await azureFunctionUtils.getAzureFunctionProject();
	let newHostProjectFile!: azureFunctionUtils.IFileFunctionObject;
	let hostFile: string;

	if (!projectFile) {
		let projectCreate = await vscode.window.showErrorMessage(constants.azureFunctionsProjectMustBeOpened,
			constants.createProject, constants.learnMore);
		if (projectCreate === constants.learnMore) {
			void vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(constants.sqlBindingsDoc));
			return;
		} else if (projectCreate === constants.createProject) {
			// start the create azure function project flow
			try {
				// because of an AF extension API issue, we have to get the newly created file by adding a watcher
				// issue: https://github.com/microsoft/vscode-azurefunctions/issues/3052
				newHostProjectFile = await azureFunctionUtils.waitForNewHostFile();
				await azureFunctionApi.createFunction({});
				const timeoutForHostFile = utils.timeoutPromise(constants.timeoutProjectError);
				hostFile = await Promise.race([newHostProjectFile.filePromise, timeoutForHostFile]);
				if (hostFile) {
					// start the add sql binding flow
					projectFile = await azureFunctionUtils.getAzureFunctionProject();
				}
			} catch (error) {
				void vscode.window.showErrorMessage(utils.formatString(constants.errorNewAzureFunction, error.message ?? error));
				return;
			} finally {
				newHostProjectFile.watcherDisposable.dispose();
			}
		}
	}

	if (projectFile) {
		// because of an AF extension API issue, we have to get the newly created file by adding a watcher
		// issue: https://github.com/microsoft/vscode-azurefunctions/issues/2908
		const newFunctionFileObject = azureFunctionUtils.waitForNewFunctionFile(projectFile);
		let functionFile: string;
		let functionName: string;

		try {
			// get function name from user
			let uniqueFunctionName = await utils.getUniqueFileName(path.dirname(projectFile), table);
			functionName = await vscode.window.showInputBox({
				title: constants.functionNameTitle,
				value: uniqueFunctionName,
				ignoreFocusOut: true,
				validateInput: input => input ? undefined : constants.nameMustNotBeEmpty
			}) as string;
			if (!functionName) {
				return;
			}

			// create C# HttpTrigger
			await azureFunctionApi.createFunction({
				language: 'C#',
				templateId: 'HttpTrigger',
				functionName: functionName,
				folderPath: projectFile
			});

			// check for the new function file to be created and dispose of the file system watcher
			const timeoutForFunctionFile = utils.timeoutPromise(constants.timeoutAzureFunctionFileError);
			functionFile = await Promise.race([newFunctionFileObject.filePromise, timeoutForFunctionFile]);
		} finally {
			newFunctionFileObject.watcherDisposable.dispose();
		}

		// select input or output binding
		const inputOutputItems: (vscode.QuickPickItem & { type: BindingType })[] = [
			{
				label: constants.input,
				type: BindingType.input
			},
			{
				label: constants.output,
				type: BindingType.output
			}
		];

		const selectedBinding = await vscode.window.showQuickPick(inputOutputItems, {
			canPickMany: false,
			title: constants.selectBindingType,
			ignoreFocusOut: true
		});

		if (!selectedBinding) {
			return;
		}

		await azureFunctionUtils.addNugetReferenceToProjectFile(projectFile);
		await azureFunctionUtils.addConnectionStringToConfig(connectionString, projectFile);

		let objectName = utils.generateQuotedFullName(schema, table);
		const azureFunctionsService = await utils.getAzureFunctionService();
		await azureFunctionsService.addSqlBinding(
			selectedBinding.type,
			functionFile,
			functionName,
			objectName,
			constants.sqlConnectionString
		);

		azureFunctionUtils.overwriteAzureFunctionMethodBody(functionFile);
	}
}

/**
 * Adds a SQL Binding to a specified Azure function in a file
 * @param bindingType Type of SQL Binding
 * @param filePath Path of the file where the Azure Functions are
 * @param functionName Name of the function where the SQL Binding is to be added
 * @param objectName Name of Object for the SQL Query
 * @param connectionStringSetting Setting for the connection string
 * @returns Azure Function SQL binding
 */
export async function addSqlBinding(
	bindingType: BindingType,
	filePath: string,
	functionName: string,
	objectName: string,
	connectionStringSetting: string
): Promise<ResultStatus> {
	const params: AddSqlBindingParams = {
		bindingType: bindingType,
		filePath: filePath,
		functionName: functionName,
		objectName: objectName,
		connectionStringSetting: connectionStringSetting
	};

	const vscodeMssqlApi = await utils.getVscodeMssqlApi();

	return vscodeMssqlApi.sendRequest(azureFunctionsContracts.AddSqlBindingRequest.type, params);
}


/**
 * Gets the names of the Azure functions in the file
 * @param filePath Path of the file to get the Azure functions
 * @returns array of names of Azure functions in the file
 */
export async function getAzureFunctions(filePath: string): Promise<GetAzureFunctionsResult> {
	const params: GetAzureFunctionsParams = {
		filePath: filePath
	};
	const vscodeMssqlApi = await utils.getVscodeMssqlApi();

	return vscodeMssqlApi.sendRequest(azureFunctionsContracts.GetAzureFunctionsRequest.type, params);
}