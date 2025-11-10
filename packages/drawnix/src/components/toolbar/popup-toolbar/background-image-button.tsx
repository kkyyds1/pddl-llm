import classNames from 'classnames';
import React, { useRef, useState } from 'react';
import { ATTACHED_ELEMENT_CLASS_NAME, PlaitBoard } from '@plait/core';
import { ToolButton } from '../../tool-button';
import { ImageIcon } from '../../icons';
import { Island } from '../../island';
import { Popover, PopoverContent, PopoverTrigger } from '../../popover/popover';
import {
  clearBackgroundImage,
  setBackgroundImage,
} from '../../../transforms/property';
import { useI18n } from '../../../i18n';
import { getDataURL, isSupportedImageFile } from '../../../data/blob';

type PopupBackgroundImageButtonProps = {
  board: PlaitBoard;
  title: string;
  currentImage?: string;
};

export const PopupBackgroundImageButton: React.FC<
  PopupBackgroundImageButtonProps
> = ({ board, title, currentImage }) => {
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { t } = useI18n();

  const handleUpload = async (file: File | null | undefined) => {
    if (!file || !isSupportedImageFile(file)) {
      return;
    }
    const dataURL = await getDataURL(file);
    setBackgroundImage(board, dataURL);
  };

  return (
    <Popover
      sideOffset={12}
      open={open}
      onOpenChange={(nextOpen) => setOpen(nextOpen)}
      placement="top"
    >
      <PopoverTrigger asChild>
        <ToolButton
          className={classNames('property-button')}
          visible={true}
          icon={ImageIcon}
          type="button"
          title={title}
          aria-label={title}
          onPointerUp={() => {
            setOpen(!open);
          }}
        />
      </PopoverTrigger>
      <PopoverContent container={PlaitBoard.getBoardContainer(board)}>
        <Island
          padding={4}
          className={classNames(
            ATTACHED_ELEMENT_CLASS_NAME,
            'background-image-popover'
          )}
        >
          <button
            type="button"
            className="background-image-popover__action"
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.value = '';
                fileInputRef.current.click();
              }
            }}
          >
            {t('popupToolbar.uploadBackgroundImage')}
          </button>
          {currentImage && (
            <button
              type="button"
              className="background-image-popover__action background-image-popover__action--danger"
              onClick={() => {
                clearBackgroundImage(board);
                setOpen(false);
              }}
            >
              {t('popupToolbar.removeBackgroundImage')}
            </button>
          )}
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              void handleUpload(file);
              setOpen(false);
            }}
          />
        </Island>
      </PopoverContent>
    </Popover>
  );
};
