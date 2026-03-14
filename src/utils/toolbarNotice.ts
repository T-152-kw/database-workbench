import { Intent, OverlayToaster } from '@blueprintjs/core';
import type { Toaster } from '@blueprintjs/core';
import { useNotificationStore } from '../stores';
import type { NotificationIntent } from '../stores';

type ToolbarRequirement = 'connection' | 'database' | 'query';

let toolbarToaster: Toaster | null = null;

const getToolbarToaster = async () => {
  if (!toolbarToaster) {
    toolbarToaster = await OverlayToaster.create({ position: 'bottom-right' });
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

const mapIntentToNotificationIntent = (intent: Intent): NotificationIntent => {
  switch (intent) {
    case Intent.SUCCESS:
      return 'success';
    case Intent.WARNING:
      return 'warning';
    case Intent.DANGER:
      return 'danger';
    case Intent.PRIMARY:
    default:
      return 'primary';
  }
};

const showToastWithTracking = async (
  message: string,
  intent: Intent,
  timeout: number,
) => {
  const toaster = await getToolbarToaster();

  toaster.show({
    message,
    intent,
    timeout,
    onDismiss: (didTimeoutExpire: boolean) => {
      // 只有当超时自动关闭时才记录到通知中心
      if (didTimeoutExpire) {
        const { addNotification } = useNotificationStore.getState();
        addNotification({
          message,
          intent: mapIntentToNotificationIntent(intent),
        });
      }
    },
  });
};

export const showToolbarRequirementNotice = async (
  actionLabel: string,
  requirement: ToolbarRequirement,
) => {
  const message = buildRequirementMessage(actionLabel, requirement);
  await showToastWithTracking(message, Intent.PRIMARY, 2600);
};

export const showEditConnectionNotice = async (connectionName: string) => {
  const message = `连接"${connectionName}"当前处于打开状态，请先关闭连接后再编辑。`;
  await showToastWithTracking(message, Intent.WARNING, 3000);
};

export const showExportSuccessNotice = async (rowCount: number, filePath: string) => {
  const message = `导出成功：${rowCount} 行数据已保存到 ${filePath}`;
  await showToastWithTracking(message, Intent.SUCCESS, 5000);
};

export const showExportFailedNotice = async (error: string) => {
  const message = `导出失败：${error}`;
  await showToastWithTracking(message, Intent.DANGER, 5000);
};

export const showImportSuccessNotice = async (rowCount: number) => {
  const message = `导入成功：${rowCount} 行数据已导入`;
  await showToastWithTracking(message, Intent.SUCCESS, 5000);
};

export const showImportFailedNotice = async (error: string) => {
  const message = `导入失败：${error}`;
  await showToastWithTracking(message, Intent.DANGER, 5000);
};
