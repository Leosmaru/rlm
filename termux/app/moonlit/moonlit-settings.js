
/**
 * Define which categories go into which tab
 * Reorganized for better user experience
 */
window.MOONLIT_TABS = {
    'core-settings': [
        'theme-colors',        // Theme Colors
        'chat-style',         // Global Message Style
        'background-effects',  // Background Effects
        'theme-extras',         // Theme Extras
        'raw-css',              // Raw CSS
    ],
    'chat-interface': [
        'chat-general',        // General Chat Settings
        'visual-novel',         // Visual Novel Mode
        'chat-echo',           // Echo Style Settings
        'chat-whisper',        // Whisper Style Settings
        'chat-ripple'         // Ripple Style Settings
    ],
    'mobile-devices': [
        'mobile-global-settings',    // Mobile Global Settings
        'mobile-detailed-settings'    // Mobile Detailed Settings
    ]
};

/**
 * Theme settings configuration
 * Reorganized into more logical categories
 */
window.MOONLIT_SETTINGS = [
    // - - - - - - - - - - - - - - - - - - -
    // Theme Colors Tab 主題顏色分頁
    // - - - - - - - - - - - - - - - - - - -

    // Theme Colors (theme-colors) 主題顏色
    {
        "type": "color",
        "varId": "customThemeColor",
        "displayText": `Primary Theme Color`,
        "default": "rgba(81, 160, 222, 1)",
        "category": "theme-colors",
        "description": `The main interface theme color, used for highlights and accents`
    },
    {
        "type": "color",
        "varId": "customThemeColor2",
        "displayText": `Secondary Theme Color`,
        "default": "rgba(250, 198, 121, 1)",
        "category": "theme-colors",
        "description": `A complementary secondary color, used for special highlights`
    },
    {
        "type": "color",
        "varId": "customBgColor1",
        "displayText": `Main Background Color`,
        "default": "rgba(255, 255, 255, 0.1)",
        "category": "theme-colors",
        "description": `The primary background color used across various menus and buttons`
    },
    {
        "type": "color",
        "varId": "customBgColor2",
        "displayText": `Secondary Background Color`,
        "default": "rgba(255, 255, 255, 0.05)",
        "category": "theme-colors",
        "description": `The secondary background color used across various menus and buttons`
    },
    {
        "type": "color",
        "varId": "customTopBarColor",
        "displayText": `Top Menu Color`,
        "default": "rgba(23, 23, 23, 0.7)",
        "category": "theme-colors",
        "description": `Background color of the top menu (#top-bar)`
    },
    {
        "type": "color",
        "varId": "Drawer-iconColor",
        "displayText": `Menu Icon Color`,
        "default": "rgba(255, 255, 255, 0.8)",
        "category": "theme-colors",
        "description": `Color of icons in the top menu, sidebar, and dropdown menus`
    },
    {
        "type": "color",
        "varId": "sheldBackgroundColor",
        "displayText": `Chat Field Background Color`,
        "default": "rgba(0, 0, 0, 0.2)",
        "category": "theme-colors",
        "description": `Background color of the chat field (#sheld)`
    },
    {
        "type": "color",
        "varId": "customScrollbarColor",
        "displayText": `Scrollbar Color`,
        "default": "rgba(255, 255, 255, 0.5)",
        "category": "theme-colors",
        "description": `The scrollbar color on SillyTavern`
    },

    // Global Chat Style 全局聊天樣式
    {
        "type": "checkbox",
        "varId": "hideAvatarBorder",
        "displayText": `Hide Avatar Border`,
        "default": false,
        "category": "chat-style",
        "description": `Hide the border around character avatars in chat messages`,
        "cssBlock": `
            #chat .mes .avatar {
                border: unset !important;
            }
        `
    },
    {
        "type": "text",
        "varId": "custom-ChatAvatar",
        "displayText": `Chat Field Avatar Size`,
        "default": "40px",
        "category": "chat-style",
        "description": `Width and height of character avatars in the chat field`
    },
    {
        "type": "text",
        "varId": "mesParagraphSpacingTop",
        "displayText": `Message Paragraph Spacing (Top)`,
        "default": "0.4em",
        "category": "chat-style",
        "description": `Sets the spacing above each paragraph in chat messages (e.g. 0.5em, 1em)`
    },
    {
        "type": "text",
        "varId": "mesParagraphSpacingBottom",
        "displayText": `Message Paragraph Spacing (Bottom)`,
        "default": "0.6em",
        "category": "chat-style",
        "description": `Sets the spacing below each paragraph in chat messages (e.g. 0.5em, 1em)`
    },
    {
        "type": "text",
        "varId": "charNameFontSize",
        "displayText": `Character Name Font Size`,
        "default": "inherit",
        "category": "chat-style",
        "description": `Font size for character (non-user) name text (e.g. 0.9rem, 1rem)`
    },
    {
        "type": "text",
        "varId": "userNameFontSize",
        "displayText": `User Name Font Size`,
        "default": "inherit",
        "category": "chat-style",
        "description": `Font size for user name text (e.g. 0.9rem, 1rem)`
    },
    {
        "type": "text",
        "varId": "messageTextFontSize",
        "displayText": `Message Text Font Size`,
        "default": "15px",
        "category": "chat-style",
        "description": `Font size for message body text (e.g. 0.95rem, 1rem, 1.05rem)`
    },
    {
        "type": "text",
        "varId": "messageLineHeight",
        "displayText": `Message Text Line Heigh`,
        "default": "calc(var(--mainFontSize) + .5rem)",
        "category": "chat-style",
        "description": `Line height for message body text (e.g. 1.55em, 1.6em)`
    },
    {
        "type": "text",
        "varId": "messageTextLetterSpacing",
        "displayText": `Message Text Letter Spacing`,
        "default": "inherit",
        "category": "chat-style",
        "description": `Letter spacing for message body text (e.g. 0em, 0.02em)`
    },
    {
        "type": "text",
        "varId": "customlastInContext",
        "displayText": `Maximum Context Marker Style`,
        "default": "1px solid var(--customThemeColor)",
        "category": "chat-style",
        "description": `Line style for the maximum context marker`
    },

    // Background Effects (background-effects) 背景效果
    {
        "type": "slider",
        "varId": "customCSS-bg-blur",
        "displayText": `Background Blur Intensity`,
        "default": "3",
        "min": 0,
        "max": 10,
        "step": 1,
        "category": "background-effects",
        "description": `Adjusts the blur level of the background image`
    },
    {
        "type": "slider",
        "varId": "customCSS-bg-opacity",
        "displayText": `Background Image Opacity`,
        "default": "1",
        "min": 0,
        "max": 1,
        "step": 0.05,
        "category": "background-effects",
        "description": `Adjusts the opacity level of the background image`
    },
    {
        "type": "slider",
        "varId": "sheldBlurStrength",
        "displayText": `Chat Field Background Blur Intensity`,
        "default": "5",
        "min": 0,
        "max": 10,
        "step": 1,
        "category": "background-effects",
        "description": `Blur level of the chat field background (#sheld)`
    },
    {
        "type": "slider",
        "varId": "mobileSheldBlurStrength",
        "displayText": `Mobile Chat Field Background Blur Intensity`,
        "default": "0",
        "min": 0,
        "max": 10,
        "step": 1,
        "category": "background-effects",
        "description": `Blur level of the chat field background on mobile devices (#sheld)`
    },

    // Theme Extras (theme-extras) 額外主題自定義選項
    {
        "type": "checkbox",
        "varId": "enableThemeColorization",
        "displayText": `Apply Theme Colors to More UI Elements`,
        "default": false,
        "category": "theme-extras",
        "description": `Applies theme colors to more parts of the UI for a more personalized look`,
        "cssBlock": `
            /* Theme Colorization */
            .drawer-icon,
            #rightSendForm>div,
            #leftSendForm>div,
            .options-content a,
            .list-group-item,
            .mes_button {
                transition: all 0.5s ease !important;
            }
            .drawer-icon.openIcon,
            #rightSendForm>div:hover,
            #leftSendForm>div:hover,
            .options-content a:hover,
            .list-group-item:hover,
            .mes_button:hover {
                color: var(--customThemeColor) !important;
            }
            #left-nav-panel,
            #right-nav-panel,
            .drawer-content,
            #character_popup,
            #logprobsViewer,
            #floatingPrompt,
            #cfgConfig {
                border-top: 1px solid color-mix(in srgb, var(--customThemeColor) 50%, transparent) !important;
            }
            #left-nav-panel,
            #right-nav-panel,
            .drawer-content,
            #WorldInfo {
                @media screen and (max-width: 1000px) {
                    border-bottom: 1px solid color-mix(in srgb, var(--customThemeColor) 50%, transparent);
                }
            }
        `
    },
    {
    "type": "checkbox",
    "varId": "disableTopMenuAnimation",
    "displayText": `Disable Top Menu Animations`,
    "default": false,
    "category": "theme-extras",
    "description": `Disable top menu animation effects for a smoother experience on mobile devices`,
    "cssBlock": `
        .drawer-content,
        .fillLeft,
        .fillRight {
            transition-property: unset;
            transition-duration: unset;
            transition-timing-function: unset;
            transition-behavior: unset;
        }
    `
    },
    {
    "type": "checkbox",
    "varId": "forceFixedMenuHeight",
    "displayText": `Lock AI Response & Character Menu Heigh`,
    "default": true,
    "category": "theme-extras",
    "description": `Fix AI config & character menus' height to avoid display issues. Disable if using MovingUI`,
    "cssBlock": `
            /* Force Fixed Menu Height */
            .fillLeft,
            .fillRight,
            #left-nav-panel,
            #right-nav-panel {
                min-height: calc(100dvh - var(--topBarBlockSize)) !important;
                height: calc(100dvh - var(--topBarBlockSize)) !important;
                max-height: calc(100dvh - var(--topBarBlockSize)) !important;
            }
    `
    },
    {
        "type": "checkbox",
        "varId": "newMenuMaxHeight",
        "displayText": `Dynamically Adjust Menu Max Heigh`,
        "default": false,
        "category": "theme-extras",
        "description": `Dynamically adjust the menu's maximum height based on the message input field. May not work on all devices—disable this option if the menu doesn't close properly`,
        "cssBlock": `
            /* Dynamic Menu Height */
            .drawer-content {
                max-height: calc(100dvh - var(--topBarBlockSize) - var(--formSheldHeight) - 5px) !important;
            }
            @media screen and (max-width: 1000px) {
                .drawer-content,
                .fillLeft, .fillRight,
                #left-nav-panel, #right-nav-panel {
                    max-height: calc(100dvh - var(--topBarBlockSize) - var(--formSheldHeight) + 4px) !important;
                }

                #floatingPrompt,
                #cfgConfig,
                #logprobsViewer,
                #movingDivs > div,
                #character_popup {
                    max-height: calc(100dvh - var(--topBarBlockSize)) !important;
                    padding-bottom: 15px !important;
                }
            }
        `
    },
    {
        "type": "checkbox",
        "varId": "disableAllBorderRadius",
        "displayText": `Disable All Border Radius`,
        "default": false,
        "category": "theme-extras",
        "description": `Completely disable all border-radius and outline-radius effects throughout the UI`,
        "cssBlock": `
            /* Disable Border Radius */
            :root {
                --avatar-base-border-radius: 0 !important;
            }
            *, *::before, *::after {
                border-radius: 0 !important;
                border-top-left-radius: 0 !important;
                border-top-right-radius: 0 !important;
                border-bottom-left-radius: 0 !important;
                border-bottom-right-radius: 0 !important;
                outline-radius: 0 !important;
                -moz-outline-radius: 0 !important;
            }
            body.whisperstyle #chat .mes::before {
                border-radius: 0 !important;
            }
            body.ripplestyle #chat .mes .mesAvatarWrapper .avatar,
            body.ripplestyle #chat .mes .mesAvatarWrapper .avatar img,
            #extensionTopBar,
            body:has(#extensionConnectionProfiles.visible) #extensionTopBar,
            #rm_ch_create_block .avatar img {
                border-radius: 0 !important;
            }
            @media screen and (max-width: 1000px) {
                #send_form {
                    border-radius: 0 !important;
                }
            }
            svg * {
                rx: 0 !important;
                ry: 0 !important;
            }
        `
    },
    {
        "type": "checkbox",
        "varId": "expandEntryInputWidth",
        "displayText": `Expand Entry Input Width`,
        "default": true,
        "category": "theme-extras",
        "description": `Hide the browser’s up/down arrows in number input fields to give more space for typing`,
        "cssBlock": `
            input[type=number]::-webkit-outer-spin-button,
            input[type=number]::-webkit-inner-spin-button {
                -webkit-appearance: none;
                margin: 0;
            }
            input[type=number] {
                -moz-appearance:textfield;
            }
        `
    },
    {
        "type": "checkbox",
        "varId": "compactWorldsLorebooksTopBar",
        "displayText": `Compact Worlds/Lorebooks Top Bar`,
        "default": true,
        "category": "theme-extras",
        "description": `Make the top fields in Worlds/Lorebooks more compact by reducing header padding and entry spacing`,
        "cssBlock": `
            .world_entry .inline-drawer-header {
                padding: 2px 10px;
            }
            .wi-card-entry {
                padding: 2px;
                margin: 2px;
            }
        `
    },

    // Advanced Custom CSS (raw-css) 無過濾額外自定義 CSS
    {
        "type": "textarea",
        "varId": "rawCustomCss",
        "displayText": `Raw Custom CSS`,
        "default": "",
        "category": "raw-css",
        "description": `Note: This is raw, unfiltered CSS with full support (including @import for custom fonts). Use with caution. Please use the Custom CSS option in User Settings first!!!`
    },

    // - - - - - - - - - - - - - - - - - - -
    // Chat Interface Tab 聊天樣式分頁
    // - - - - - - - - - - - - - - - - - - -

    // General Chat Settings (chat-general) 一般聊天設定
    {
        "type": "select",
        "varId": "customCSS-ChatGradientBlur",
        "displayText": `Chat Field Gradient Blur`,
        "default": "linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 1) 2%, rgba(0, 0, 0, 1) 98%, rgba(0, 0, 0, 0) 100%)",
        "options": [
            {
                "label": `Enable`,
                "value": "linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 1) 2%, rgba(0, 0, 0, 1) 98%, rgba(0, 0, 0, 0) 100%)"
            },
            {
                "label": `Disabled`,
                "value": "none"
            }
        ],
        "category": "chat-general",
        "description": `Applies a transparent gradient effect to the top and bottom of the chat field (#chat)`
    },
    {
    "type": "checkbox",
    "varId": "showLLMReasoningIcon",
    "displayText": `Display LLM Icon in Reasoning Block`,
    "default": false,
    "category": "chat-general",
    "description": `Shows the LLM icon in the reasoning block header for clearer identification`,
    "cssBlock": `
            .mes_reasoning_header > .icon-svg {
                display: block;
                opacity: 1 !important;
            }
        `
    },
    {
        "type": "checkbox",
        "varId": "justifyParagraphText",
        "displayText": `Justify Paragraph Tex`,
        "default": false,
        "category": "chat-general",
        "description": `Aligns paragraph text for Chinese, Japanese, and Korean for better readability; not suitable for English layou`,
        "cssBlock": `
            .mes_text p {
                text-align: justify;
                text-justify: inter-ideograph;
                }
        `
    },
    {
        "type": "checkbox",
        "varId": "enableMessageDetails",
        "displayText": `Hide Additional Message Details`,
        "default": false,
        "category": "chat-general",
        "description": `Message additional details (name, ID, time, token counter, etc.) show only on hover or click`,
        "cssBlock": `
            .mes .ch_name,
            .mes .mesIDDisplay,
            .mes .mes_timer,
            .mes .tokenCounterDisplay {
                visibility: hidden !important;
                opacity: 0 !important;
                transition: all var(--messageDetailsAnimationDuration) cubic-bezier(0.4, 0, 0.2, 1),
                            visibility 0s ease var(--messageDetailsAnimationDuration) !important;
                z-index: 10 !important;
                pointer-events: auto !important;
            }

            .mes:hover .ch_name,
            .mes:hover .mesIDDisplay,
            .mes:hover .mes_timer,
            .mes:hover .tokenCounterDisplay,
            .mes.active-message .ch_name,
            .mes.active-message .mesIDDisplay,
            .mes.active-message .mes_timer,
            .mes.active-message .tokenCounterDisplay {
                visibility: visible !important;
                opacity: 1 !important;
                transition: all var(--messageDetailsAnimationDuration) cubic-bezier(0.4, 0, 0.2, 1),
                            visibility var(--messageDetailsAnimationDuration) ease !important;
            }

            .mes .mes_reasoning_details {
                opacity: 0;
                max-height: 1px;
                transform: translateY(-10px);
                pointer-events: none;
                transition:
                    opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1),
                    transform 0.6s cubic-bezier(0.4, 0, 0.2, 1),
                    max-height 0.3s cubic-bezier(0, 0, 0.2, 1);
                will-change: opacity, transform;
            }
            .mes:hover .mes_reasoning_details,
            .mes.active-message .mes_reasoning_details {
                opacity: 1;
                visibility: visible !important;
                transform: translateY(0);
                max-height: 100%;
                pointer-events: auto;
            }

            body.flatchat,
            body.bubblechat,
            body.ripplestyle {
                .mes .ch_name,
                .mes .mesIDDisplay,
                .mes .mes_timer,
                .mes .tokenCounterDisplay {
                    margin-top: -40px;
                    background: none;
                }

                .mes:hover .ch_name,
                .mes:hover .mesIDDisplay,
                .mes:hover .mes_timer,
                .mes:hover .tokenCounterDisplay,
                .mes.active-message .ch_name,
                .mes.active-message .mesIDDisplay,
                .mes.active-message .mes_timer,
                .mes.active-message .tokenCounterDisplay {
                    margin-top: unset;
                    background: unset;
                }
            }

            body.flatchat,
            body.bubblechat,
            body.documentstyle,
            body.ripplestyle {
                .mes .ch_name,
                .mes .mesIDDisplay,
                .mes .mes_timer,
                .mes .tokenCounterDisplay {
                    transform: translateY(-40px);
                }

                .mes:hover .ch_name,
                .mes:hover .mesIDDisplay,
                .mes:hover .mes_timer,
                .mes:hover .tokenCounterDisplay,
                .mes.active-message .ch_name,
                .mes.active-message .mesIDDisplay,
                .mes.active-message .mes_timer,
                .mes.active-message .tokenCounterDisplay {
                    transform: translateY(0);
                }
            }
        `
    },
    {
        "type": "text",
        "varId": "messageDetailsAnimationDuration",
        "displayText": `Message Details Animation Duration`,
        "default": "0.8s",
        "category": "chat-general",
        "description": `Controls the animation speed for message details appearing/disappearing (e.g. 0.5s, 1.2s)`
    },
    {
    "type": "text",
    "varId": "favoriteSymbol",
    "displayText": `Favorite Symbol`,
    "default": "\"♥︎\"",
    "category": "chat-general",
    "description": `Sets the symbol displayed before a favorite character in the character management menu`
    },
    {
    "type": "checkbox",
    "varId": "favoriteSymbolAnimation",
    "displayText": `Favorite Symbol Animation`,
    "default": true,
    "category": "chat-general",
    "description": `Enables the pulsing animation effect for the favorite symbol before character names`,
    "cssBlock": `
        .character_select.is_fav .ch_name::before,
        .group_select.is_fav .ch_name::before,
        .group_member.is_fav .ch_name::before {
            animation: fadePulse 1s ease-in-out infinite;
        }
        @keyframes fadePulse {
            0%, 100% { opacity: 0.6; }
            50% { opacity: 1; }
        }
    `
    },

    // Visual Novel Mode (visual-novel) 視覺小說模式
    {
        "type": "text",
        "varId": "VN-sheld-height",
        "displayText": `Visual Novel Mode Chat Field Heigh`,
        "default": "40dvh",
        "category": "visual-novel",
        "description": `Maximum height of the chat field (#sheld) in Visual Novel mode`
    },
    {
        "type": "select",
        "varId": "VN-expression-holder",
        "displayText": `Visual Novel Mode Character Portrait Gradient Transparency`,
        "default": "linear-gradient(to bottom, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 1) 90%, rgba(0, 0, 0, 0) 100%)",
        "options": [
            {
                "label": `Enabled`,
                "value": "linear-gradient(to bottom, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 1) 90%, rgba(0, 0, 0, 0) 100%)"
            },
            {
                "label": `Disabled`,
                "value": "none"
            }
        ],
        "category": "visual-novel",
        "description": `Bottom transparency effect for character portraits in Visual Novel mode`
    },

    // Echo Style Settings (chat-echo)
    {
        "type": "text",
        "varId": "custom-EchoAvatarWidth",
        "displayText": `[Echo] Message Background Avatar Width`,
        "default": "25%",
        "category": "chat-echo",
        "description": `Width of character avatars in the message background for the Echo style`
    },
    {
        "type": "text",
        "varId": "custom-EchoAvatarHeight",
        "displayText": `[Echo] Message Background Avatar Heigh`,
        "default": "300px",
        "category": "chat-echo",
        "description": `Height of character avatars in the message background for the Echo style`
    },
    {
        "type": "text",
        "varId": "custom-EchoAvatarMobileWidth",
        "displayText": `[Echo] Mobile Message Background Avatar Width`,
        "default": "25%",
        "category": "chat-echo",
        "description": `Width of character avatars in the message background for the Echo style on mobile devices`
    },
    {
        "type": "text",
        "varId": "custom-EchoAvatarMobileHeight",
        "displayText": `[Echo] Mobile Message Background Avatar Heigh`,
        "default": "250px",
        "category": "chat-echo",
        "description": `Height of character avatars in the message background for the Echo style on mobile devices`
    },
    {
        "type": "checkbox",
        "varId": "hideEchoUserIllustration",
        "displayText": `[Echo] Hide User Message Illustration`,
        "default": false,
        "category": "chat-echo",
        "description": `Hide user message illustrations in Echo style`,
        "cssBlock": `
            body.echostyle #chat {
                .mes[is_user="true"] {
                    .name_text {
                            display: inline-block !important;
                            margin-right: 5px;
                        }
                    .mes_text,
                        .last_mes .mes_text {
                            padding: 10px 20px !important;
                            min-height: unset !important;
                        }
                    .mes_text::before {
                        display: none !important;
                    }
                }
            }
        `
    },
    {
        "type": "checkbox",
        "varId": "hideMobileEchoBackground",
        "displayText": `[Echo] Hide Message Background on Mobile`,
        "default": false,
        "category": "chat-echo",
        "description": `Hide message background illustrations on mobile for the Echo style`,
        "cssBlock": `
            body.echostyle #chat {
                @media screen and (max-width: 1000px) {
                    .mes[is_user="true"],
                    .mes[is_user="false"] {
                        .mes_text,
                        .last_mes .mes_text {
                            padding: 10px 20px !important;
                            min-height: unset !important;
                        }
                    }
                    .mes_text::before {
                        display: none !important;
                    }
                }

                .ch_name {
                    .name_text {
                        display: inline-block !important;
                        margin-right: 5px;
                    }
                }
            }
        `
    },

    // Whisper Style Settings (chat-whisper) 低語聊天風格
    {
        "type": "text",
        "varId": "customWhisperAvatarWidth",
        "displayText": `[Whisper] Message Background Avatar Width`,
        "default": "50%",
        "category": "chat-whisper",
        "description": `Width of character avatars in the message background for the Whisper style`
    },
    {
        "type": "select",
        "varId": "customWhisperAvatarAlign",
        "displayText": `[Whisper] Avatar Alignmen`,
        "default": "center",
        "options": [
            {
                "label": `Top Aligned`,
                "value": "top"
            },
            {
                "label": `Center Aligned`,
                "value": "center"
            },
            {
                "label": `Bottom Aligned`,
                "value": "bottom"
            }
        ],
        "category": "chat-whisper",
        "description": `Vertical alignment of character avatars in the message background for the Whisper style`
    },

    // Ripple Style Settings (chat-ripple) 漣漪聊天風格
    {
        "type": "text",
        "varId": "customRippleAvatarWidth",
        "displayText": `[Ripple] Message Avatar Width`,
        "default": "180px",
        "category": "chat-ripple",
        "description": `Width of character avatars in the message for the Ripple style`
    },
    {
        "type": "text",
        "varId": "customRippleAvatarMobileWidth",
        "displayText": `[Ripple] Mobile Message Avatar Width`,
        "default": "100px",
        "category": "chat-ripple",
        "description": `Width of character avatars in the message for the mobile Ripple style`
    },
    {
        "type": "checkbox",
        "varId": "hideRippleUserAvatar",
        "displayText": `[Ripple] Hide User Avatar`,
        "default": false,
        "category": "chat-ripple",
        "description": `Hide user avatars in the message for the Ripple style`,
        "cssBlock": `
            body.ripplestyle #chat .mes[is_user="true"] {
                .mesAvatarWrapper {
                    margin-top: 35px;
                    top: 35px;
                }
                .avatar {
                    display: none !important;
                }
                .mes_timer,
                .mesIDDisplay,
                .tokenCounterDisplay {
                    margin-left: 10px;
                }
            }
        `
    },

    // - - - - - - - - - - - - - - - - - - -
    // Mobile Devices Tab 行動裝置設定分頁
    // - - - - - - - - - - - - - - - - - - -

    // Mobile Global Settings (mobile-global-settings) 一般行動樣式
    {
        "type": "checkbox",
        "varId": "enableMobile-hidden_scrollbar",
        "displayText": `Enable Mobile Hidden Scrollbar`,
        "default": true,
        "category": "mobile-global-settings",
        "description": `Hides scrollbars for a clean mobile interface`,
        "cssBlock":  `
            /* Mobile Hidden Scrollbar */
            @media screen and (max-width: 1000px) {
                * {
                    scrollbar-width: none !important;
                    -ms-overflow-style: none !important;
                }
                *::-webkit-scrollbar {
                    display: none !important;
                }

                .scrollableInner,
                #form_create,
                #rm_print_characters_block,
                #extensionSideBar #extensionSideBarContainer {
                    padding: 0 !important;
                }
            }
        `
    },
    {
        "type": "checkbox",
        "varId": "enableMobile-send_form",
        "displayText": `Enable New Mobile Input Field`,
        "default": true,
        "category": "mobile-global-settings",
        "description": `A message input field designed for mobile, providing a wider input box`,
        "cssBlock":  `
            /* Mobile Input Field */
            @media screen and (max-width: 1000px) {
                #form_sheld {}

                body:has([data-slide-toggle="shown"]) #send_form  {
                    border-radius: 0 !important;
                }

                /* Mobile Chat Input Overall */
                #send_form {
                    margin-bottom: 0 !important;
                    min-height: 100% !important;
                    padding: 5px 15px;
                    padding-top: 8px;
                    border-radius: 15px 15px 0 0 !important;
                    transition: all 0.5s ease;

                    &:focus-within {
                        border-top: 1.25px solid var(--customThemeColor) !important;
                        box-shadow: 0 0 5px var(--customThemeColor);
                    }

                    &.compact {
                        #leftSendForm,
                        #rightSendForm {
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            flex-wrap: nowrap;
                            width: unset;
                        }
                    }
                }

                /* Mobile Chat Menu */
                #nonQRFormItems {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    grid-template-rows: auto auto;
                    grid-template-areas:
                    "textarea textarea"
                    "left right";
                    gap: 0;
                    padding: 0;

                    #send_textarea {
                        grid-area: textarea;
                        box-sizing: border-box;
                        width: 100%;
                        padding: 5px 6px;
                        margin-top: 3px;
                    }
                }

                /* Mobile Left & Right Chat Menu */
                #leftSendForm,
                #rightSendForm {
                    margin: 3px 0;
                }
                #leftSendForm {
                    grid-area: left;
                    display: flex;
                    align-items: center;
                    justify-content: flex-start !important;
                }
                #rightSendForm {
                    grid-area: right;
                    display: flex;
                    align-items: center;
                    justify-content: flex-end !important;
                }

                #rightSendForm > div,
                #leftSendForm > div,
                #nonQRFormItems #options_button {
                    font-size: 16px;
                }
                #nonQRFormItems #options_button {
                    margin-right: 10px;
                }

                #leftSendForm>div {
                    width: var(--bottomFormBlockSize) !important;
                }
            }
    `
    },
    {
    "type": "checkbox",
    "varId": "inlineMobileMeta",
    "displayText": `Inline Character, Timestamp & Icons on Mobile`,
    "default": false,
    "category": "mobile-global-settings",
    "description": `Show character names, timestamps, and model icons in one line on mobile`,
    "cssBlock": `
        @media (max-width: 1000px) {
            body:not(.echostyle) .name_text {
                width: unset !important;
            }
            body.whisperstyle:not(.big-avatars) #chat {
                .mes {
                    padding-top: 75px !important;
                }
            }
        }
    `
    },
    {
        "type": "checkbox",
        "varId": "increaseMobileInputSpacing",
        "displayText": `Increase Chat Input Field Spacing on Mobile`,
        "default": false,
        "category": "mobile-global-settings",
        "description": `Add extra bottom padding to chat input fields on mobile devices (screen width ≤ 1000px)`,
        "cssBlock": `
            @media screen and (max-width: 1000px) {
                #send_form {
                    padding-bottom: 23px;
                }
            }
        `
    },
    {
        "type": "checkbox",
        "varId": "increaseDesktopInputSpacing",
        "displayText": `Increase Chat Input Field Spacing on Desktop & Table`,
        "default": false,
        "category": "mobile-global-settings",
        "description": `Add extra bottom margin to chat input fields on larger screens (tablets and desktops)`,
        "cssBlock": `
            #form_sheld {
                margin-bottom: 5px;

                @media only screen and (min-width: 1024px) and (-webkit-min-device-pixel-ratio: 2) and (pointer: fine) {
                    margin-bottom: 22.5px;
                }
            }
        `
    },
    {
        "type": "checkbox",
        "varId": "fixTabletMenuLayout",
        "displayText": `Fix Tablet Menu Layou`,
        "default": false,
        "category": "mobile-global-settings",
        "description": `Optimized for tablet users to prevent menu layout issues. Note: Tablet support in SillyTavern is currently limited and may not address all issues`,
        "cssBlock": `
            .drawer-content {
                top: -3px !important;
            }
            .fillLeft,
            .fillRight {
                width: 100dvw !important;
                min-width: 100dvw !important;
            }
        `
    },

    // Mobile Detailed Settings (mobile-detailed-settings) 進階行動樣式
    {
        "type": "select",
        "varId": "mobileQRsBarHeight",
        "displayText": `Mobile QRs Bar Heigh`,
        "default": "2",
        "options": [
            {
                "label": `Compact (1 row)`,
                "value": "1"
            },
            {
                "label": `Default (2 rows)`,
                "value": "2"
            },
            {
                "label": `Extended (3 rows)`,
                "value": "3"
            }
        ],
        "category": "mobile-detailed-settings",
        "description": `Sets the maximum number of visible rows in the QRs bar on mobile devices (supports scrolling)`
    },
    {
        "type": "checkbox",
        "varId": "moveQRsBelowInputMobile",
        "displayText": `Move QRs Bar Below Input on Mobile`,
        "default": true,
        "category": "mobile-detailed-settings",
        "description": `On mobile devices (screen width ≤ 1000px), move the QRs menu below the chat input to avoid interference from message inpu`,
        "cssBlock": `
            /* Mobile QR position adjustment */
            @media screen and (max-width: 1000px) {
                #send_form.compact {
                    flex-direction: column;
                }

                #file_form {
                    order: 1 !important;
                }
                #nonQRFormItems {
                    order: 2 !important;
                }
                #qr--bar {
                    order: 3 !important;
                }

                #leftSendForm {
                    padding-left: 6px;
                }
                #rightSendForm {
                    padding-right: 6px;
                }
            }
        `
    },
    {
        "type": "checkbox",
        "varId": "enableMobile-horizontal_hotswap",
        "displayText": `Enable Horizontal HotSwap Scroll on Mobile`,
        "default": false,
        "category": "mobile-detailed-settings",
        "description": `Allows horizontal scrolling for the quick character selection menu (#HotSwapWrapper) on mobile`,
        "cssBlock":  `
            @media screen and (max-width: 1000px) {
                body.big-avatars #HotSwapWrapper .hotswap.avatars_inline {
                    max-height: unset;
                }
                #HotSwapWrapper:hover .hotswap.avatars_inline {
                    max-height: unset;
                    overflow: unset;
                    transition: unset;
                }
                #HotSwapWrapper:not(:hover) .hotswap.avatars_inline {
                    transition: unset;
                }
                .hotswap.avatars_inline {
                    flex-wrap: nowrap !important;
                    overflow-x: auto !important;
                    overflow-y: hidden !important;
                    padding-right: 30px !important;

                    *:focus {
                        outline: none;
                    }
                }
            }
        `
    }
];
