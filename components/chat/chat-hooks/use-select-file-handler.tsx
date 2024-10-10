import { ChatbotUIContext } from "@/context/context"
import { createDocXFile, createFile } from "@/db/files"
import { LLM_LIST } from "@/lib/models/llm/llm-list"
import mammoth from "mammoth"
import { useContext, useEffect, useState } from "react"
import { toast } from "sonner"
import * as chardet from "chardet"
import * as iconv from "iconv-lite"
export const TO_UTF8_FILE_TYPES = [
  "text/csv",
  "application/json",
  "text/markdown",
  "text/plain"
].join(",")
export const ACCEPTED_FILE_TYPES = [
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/json",
  "text/markdown",
  "application/pdf",
  "text/plain"
].join(",")

export const useSelectFileHandler = () => {
  const {
    selectedWorkspace,
    profile,
    chatSettings,
    setNewMessageImages,
    setNewMessageFiles,
    setShowFilesDisplay,
    setFiles,
    setUseRetrieval
  } = useContext(ChatbotUIContext)

  const [filesToAccept, setFilesToAccept] = useState(ACCEPTED_FILE_TYPES)

  useEffect(() => {
    handleFilesToAccept()
  }, [chatSettings?.model])

  const handleFilesToAccept = () => {
    const model = chatSettings?.model
    const FULL_MODEL = LLM_LIST.find(llm => llm.modelId === model)

    if (!FULL_MODEL) return

    setFilesToAccept(
      FULL_MODEL.imageInput
        ? `${ACCEPTED_FILE_TYPES},image/*`
        : ACCEPTED_FILE_TYPES
    )
  }
  // Helper function to read the file as an ArrayBuffer
  const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = reject
      reader.readAsArrayBuffer(file)
    })
  }

  const handleSelectDeviceFile = async (file: File) => {
    if (!profile || !selectedWorkspace || !chatSettings) return

    setShowFilesDisplay(true)
    setUseRetrieval(true)

    if (file) {
      // // 将文件格式转换成utf-8
      if (TO_UTF8_FILE_TYPES.split(",").includes(file.type)) {
        // Read the file as an ArrayBuffer using FileReader
        const arrayBuffer = await readFileAsArrayBuffer(file)
        const fileBuffer = Buffer.from(arrayBuffer)

        // Detect the encoding of the file
        const detectedEncoding = chardet.detect(fileBuffer)

        if (!detectedEncoding) {
          throw new Error("Unable to detect file encoding")
        }

        // console.log(`Detected encoding: ${detectedEncoding}`);

        // Decode the buffer into a string using the detected encoding
        const decodedContent = iconv.decode(fileBuffer, detectedEncoding)

        // Encode the string into a buffer using UTF-8
        const utf8Buffer = iconv.encode(decodedContent, "utf-8")

        // Create a new Blob with the UTF-8 encoded content
        const utf8Blob = new Blob([utf8Buffer], { type: file.type })

        // Create a new File object with the same name and UTF-8 encoded content
        const utf8File = new File([utf8Blob], file.name, { type: file.type })

        // console.log('Converted file:', utf8File);
        file = utf8File
      }

      let simplifiedFileType = file.type.split("/")[1]

      let reader = new FileReader()

      if (file.type.includes("image")) {
        reader.readAsDataURL(file)
      } else if (ACCEPTED_FILE_TYPES.split(",").includes(file.type)) {
        if (simplifiedFileType.includes("vnd.adobe.pdf")) {
          simplifiedFileType = "pdf"
        } else if (
          simplifiedFileType.includes(
            "vnd.openxmlformats-officedocument.wordprocessingml.document" ||
              "docx"
          )
        ) {
          simplifiedFileType = "docx"
        }

        setNewMessageFiles(prev => [
          ...prev,
          {
            id: "loading",
            name: file.name,
            type: simplifiedFileType,
            file: file
          }
        ])

        // Handle docx files
        if (
          file.type.includes(
            "vnd.openxmlformats-officedocument.wordprocessingml.document" ||
              "docx"
          )
        ) {
          const arrayBuffer = await file.arrayBuffer()
          const result = await mammoth.extractRawText({
            arrayBuffer
          })

          const createdFile = await createDocXFile(
            result.value,
            file,
            {
              user_id: profile.user_id,
              description: "",
              file_path: "",
              name: file.name,
              size: file.size,
              tokens: 0,
              type: simplifiedFileType
            },
            selectedWorkspace.id,
            chatSettings.embeddingsProvider
          )

          setFiles(prev => [...prev, createdFile])

          setNewMessageFiles(prev =>
            prev.map(item =>
              item.id === "loading"
                ? {
                    id: createdFile.id,
                    name: createdFile.name,
                    type: createdFile.type,
                    file: file
                  }
                : item
            )
          )

          reader.onloadend = null

          return
        } else {
          // Use readAsArrayBuffer for PDFs and readAsText for other types
          file.type.includes("pdf")
            ? reader.readAsArrayBuffer(file)
            : reader.readAsText(file)
        }
      } else {
        throw new Error("Unsupported file type")
      }

      reader.onloadend = async function () {
        try {
          if (file.type.includes("image")) {
            // Create a temp url for the image file
            const imageUrl = URL.createObjectURL(file)

            // This is a temporary image for display purposes in the chat input
            setNewMessageImages(prev => [
              ...prev,
              {
                messageId: "temp",
                path: "",
                base64: reader.result, // base64 image
                url: imageUrl,
                file
              }
            ])
          } else {
            const createdFile = await createFile(
              file,
              {
                user_id: profile.user_id,
                description: "",
                file_path: "",
                name: file.name,
                size: file.size,
                tokens: 0,
                type: simplifiedFileType
              },
              selectedWorkspace.id,
              chatSettings.embeddingsProvider
            )

            setFiles(prev => [...prev, createdFile])

            setNewMessageFiles(prev =>
              prev.map(item =>
                item.id === "loading"
                  ? {
                      id: createdFile.id,
                      name: createdFile.name,
                      type: createdFile.type,
                      file: file
                    }
                  : item
              )
            )
          }
        } catch (error: any) {
          toast.error("Failed to upload. " + error?.message, {
            duration: 10000
          })
          setNewMessageImages(prev =>
            prev.filter(img => img.messageId !== "temp")
          )
          setNewMessageFiles(prev => prev.filter(file => file.id !== "loading"))
        }
      }
    }
  }

  return {
    handleSelectDeviceFile,
    filesToAccept
  }
}
