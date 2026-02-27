import React, { useState, useMemo } from 'react';
import { Dialog, Classes, Button, FormGroup, InputGroup, HTMLSelect } from '@blueprintjs/core';

interface CreateDatabaseDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, charset: string, collation: string) => void;
}

const CHARSET_COLLATIONS: Record<string, string[]> = {
  utf8mb4: ['utf8mb4_0900_ai_ci', 'utf8mb4_general_ci', 'utf8mb4_unicode_ci', 'utf8mb4_bin'],
  utf8: ['utf8_general_ci', 'utf8_unicode_ci', 'utf8_bin'],
  gbk: ['gbk_chinese_ci', 'gbk_bin'],
  latin1: ['latin1_swedish_ci', 'latin1_bin'],
};

const CHARSETS = ['utf8mb4', 'utf8', 'gbk', 'latin1'];

export const CreateDatabaseDialog: React.FC<CreateDatabaseDialogProps> = ({
  isOpen,
  onClose,
  onCreate,
}) => {
  const [name, setName] = useState('');
  const [charset, setCharset] = useState('utf8mb4');
  const [collation, setCollation] = useState('utf8mb4_0900_ai_ci');

  const collations = useMemo(() => CHARSET_COLLATIONS[charset] || [], [charset]);

  const handleCharsetChange = (newCharset: string) => {
    setCharset(newCharset);
    const newCollations = CHARSET_COLLATIONS[newCharset];
    if (newCollations && newCollations.length > 0) {
      setCollation(newCollations[0]);
    }
  };

  const handleCreate = () => {
    if (!name.trim()) return;
    onCreate(name.trim(), charset, collation);
    handleClose();
  };

  const handleClose = () => {
    setName('');
    setCharset('utf8mb4');
    setCollation('utf8mb4_0900_ai_ci');
    onClose();
  };

  const canCreate = name.trim().length > 0;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title="新建数据库"
      icon="database"
      className="create-database-dialog"
    >
      <div className={Classes.DIALOG_BODY}>
        <FormGroup label="名称" labelFor="db-name" labelInfo="*">
          <InputGroup
            id="db-name"
            placeholder="数据库名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormGroup>

        <FormGroup label="字符集" labelFor="db-charset">
          <HTMLSelect
            id="db-charset"
            value={charset}
            onChange={(e) => handleCharsetChange(e.target.value)}
            options={CHARSETS.map((c) => ({ value: c, label: c }))}
            fill
          />
        </FormGroup>

        <FormGroup label="排序规则" labelFor="db-collation">
          <HTMLSelect
            id="db-collation"
            value={collation}
            onChange={(e) => setCollation(e.target.value)}
            options={collations.map((c) => ({ value: c, label: c }))}
            fill
          />
        </FormGroup>
      </div>

      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={handleClose}>取消</Button>
          <Button intent="primary" onClick={handleCreate} disabled={!canCreate}>
            创建
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
