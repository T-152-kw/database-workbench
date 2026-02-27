import { Intent, OverlayToaster } from '@blueprintjs/core';
import type { Toaster } from '@blueprintjs/core';

type ToolbarRequirement = 'connection' | 'database' | 'query';

let toolbarToaster: Toaster | null = null;

const getToolbarToaster = async () => {
  if (!toolbarToaster) {
    toolbarToaster = await OverlayToaster.create({ position: 'top' });
  }
  return toolbarToaster;
};

const buildRequirementMessage = (actionLabel: string, requirement: ToolbarRequirement) => {
  if (requirement === 'database') {
    return `请在左侧连接树中选中具体数据库后再执行"${actionLabel}"。`;
  }
  if (requirement === 'query') {
    return `请转到查询标签页后再执行"${actionLabel}"。`;
  }
  return `请先在左侧连接树中选中连接后再执行"${actionLabel}"。`;
};

export const showToolbarRequirementNotice = async (
  actionLabel: string,
  requirement: ToolbarRequirement,
) => {
  const toaster = await getToolbarToaster();
  toaster.show({
    message: buildRequirementMessage(actionLabel, requirement),
    intent: Intent.PRIMARY,
    timeout: 2600,
  });
};

export const showEditConnectionNotice = async (connectionName: string) => {
  const toaster = await getToolbarToaster();
  toaster.show({
    message: `连接"${connectionName}"当前处于打开状态，请先关闭连接后再编辑。`,
    intent: Intent.WARNING,
    timeout: 3000,
  });
};

export const showExportSuccessNotice = async (rowCount: number, filePath: string) => {
  const toaster = await getToolbarToaster();
  toaster.show({
    message: `导出成功：${rowCount} 行数据已保存到 ${filePath}`,
    intent: Intent.SUCCESS,
    timeout: 5000,
  });
};

export const showExportFailedNotice = async (error: string) => {
  const toaster = await getToolbarToaster();
  toaster.show({
    message: `导出失败：${error}`,
    intent: Intent.DANGER,
    timeout: 5000,
  });
};

export const showImportSuccessNotice = async (rowCount: number) => {
  const toaster = await getToolbarToaster();
  toaster.show({
    message: `导入成功：${rowCount} 行数据已导入`,
    intent: Intent.SUCCESS,
    timeout: 5000,
  });
};

export const showImportFailedNotice = async (error: string) => {
  const toaster = await getToolbarToaster();
  toaster.show({
    message: `导入失败：${error}`,
    intent: Intent.DANGER,
    timeout: 5000,
  });
};
