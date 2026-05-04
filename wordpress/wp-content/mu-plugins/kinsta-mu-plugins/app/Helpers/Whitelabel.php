<?php

namespace Kinsta\KMP\Helpers;

use Kinsta\Cache_Purge;
use Kinsta\KMP;
use Kinsta\KMP\Cache\Autopurge;
use Kinsta\KMP\Contracts\Autopurgable;

use function Kinsta\KMP\debug_log;
use function Kinsta\KMP\is_autopurge_enabled;

class Whitelabel
{
    /** @var bool|array{"menu_key":string,"menu_title":string,"menu_icon":?string} */
    private $values = false;

    /** @var bool|array{"menu_key":string,"menu_title":string,"menu_icon":?string} */
    private array $defaults = [];

    /** @param bool|array{"menu_key":string,"menu_title":string,"menu_icon":?string} $values */
    public function __construct($values = false)
    {
        $this->values = $values;
    }

    public function getMenuKey(?string $name = null): string
    {
        if (! $this->isEnabled()) {
            return $this->getDefaultMenuKey($name);
        }

        if (is_string($name) && trim($name) !== '') {
            $name = '-' . sanitize_key($name);
        }

        if (is_array($this->values)) {
            $menuKey = $this->values['menu_key'] ?? '';

            if (is_string($menuKey) && trim($menuKey) !== '') {
                $menuKey = sanitize_key($menuKey);
            }

            return $menuKey . $name;
        }

        return 'server' . $name;
    }

    private function getDefaultMenuKey(?string $name = null): string
    {
        if (!$name || !is_string($name)) {
            return 'kinsta';
        }

        return 'kinsta' . '-' . sanitize_key($name);
    }

    public function getMenuTitle(): string
    {
        if (! $this->isEnabled()) {
            return __( 'Kinsta Cache', 'kinsta-mu-plugins' );
        }

        if (is_array($this->values)) {
            $menuLabel = $this->values['menu_title'] ?? '';

            if (is_string($menuLabel) && trim($menuLabel) !== '') {
                return sanitize_text_field($menuLabel);
            }
        }

        return __( 'Server Cache', 'kinsta-mu-plugins' );
    }

    /**
     * Override the default menu icon if provided in the configuration.
     * Otherwise, just use cloud icon as the default for the server
     * cache menu.
     *
     * @return string|null
     */
    public function getMenuIcon(): ?string
    {
        if (is_array($this->values) && isset($this->values['menu_icon'])) {
            return sanitize_text_field($this->values['menu_icon']);
        }

        return 'dashicons-cloud';
    }

    public function isEnabled(): bool
	{
        if ( is_bool( $this->values ) ) {
            return $this->values;
        }

        if (
            is_array( $this->values ) &&
            isset( $this->values['menu_key'], $this->values['menu_title'] ) &&
            $this->values['menu_key'] !== '' &&
            $this->values['menu_title'] !== ''
        ) {
            return true;
        }

        return false;
	}
}
