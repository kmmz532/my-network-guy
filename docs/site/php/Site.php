<?php
declare(strict_types=1);

namespace Site;

enum PortType: string {
    case Rj45 = 'rj45';
    case Sfp = 'sfp';

    public function label(): string {
        return match ($this) {
            self::Rj45 => 'RJ-45',
            self::Sfp => 'SFP',
        };
    }
}

final readonly class Port {
    public PortType $type;
    public int $count;
    public int $speedMbps;

    public function __construct(PortType $type, int $count, int $speedMbps) {
        $this->type = $type;
        $this->count = $count;
        $this->speedMbps = $speedMbps;
    }

    /** @param array{type: string, count: int, speedMbps: int} $raw */
    public static function fromArray(array $raw): self {
        return new self(PortType::from($raw['type']), $raw['count'], $raw['speedMbps']);
    }

    public function label(): string {
        $speed = $this->speedMbps >= 1000 ? ($this->speedMbps / 1000) . ' Gbps' : "{$this->speedMbps} Mbps";
        return "{$this->type->label()} × {$this->count}（{$speed}）";
    }
}

final readonly class Device {
    public string $id;
    public string $name;
    public string $desc;
    public string $category;
    public int $price;
    public int $unlockLevel;
    public array $ports;
    public array $capabilities;

    /**
     * @param list<Port> $ports
     * @param list<string> $capabilities
     */
    public function __construct(string $id, string $name, string $desc, string $category, int $price, int $unlockLevel, array $ports, array $capabilities) {
        $this->id = $id;
        $this->name = $name;
        $this->desc = $desc;
        $this->category = $category;
        $this->price = $price;
        $this->unlockLevel = $unlockLevel;
        $this->ports = $ports;
        $this->capabilities = $capabilities;
    }

    public static function fromArray(array $raw): self {
        return new self(
            id: $raw['id'],
            name: $raw['name'],
            desc: $raw['desc'],
            category: $raw['category'],
            price: $raw['price'],
            unlockLevel: $raw['unlockLevel'],
            ports: array_map(Port::fromArray(...), $raw['ports']),
            capabilities: $raw['capabilities'],
        );
    }
}

final readonly class NavItem {
    public function __construct(public string $href, public string $title) {}
}

/** ページの枠（layout.php）に流し込む値 */
final readonly class Page {
    public string $title;
    public string $body;
    public array $nav;
    public string $current;

    /** @param list<NavItem> $nav */
    public function __construct(string $title, string $body, array $nav, string $current) {
        $this->title = $title;
        $this->body = $body;
        $this->nav = $nav;
        $this->current = $current;
    }
}

final readonly class View {
    public function __construct(private string $dir) {}

    public static function e(string|int|float $value): string {
        return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    /** テンプレートを変数つきで評価し、出力を文字列で返す */
    public function render(string $name, array $vars): string {
        $file = "{$this->dir}/{$name}.php";
        if (!is_file($file))
            throw new \RuntimeException("テンプレートがない: {$file}");
        
        ob_start();
        try {
            (static function (string $__file, array $__vars): void {
                extract($__vars);
                require $__file;
            })($file, $vars);
            return (string) ob_get_contents();
        } finally {
            ob_end_clean();
        }
    }
}
