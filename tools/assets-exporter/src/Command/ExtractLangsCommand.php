<?php

namespace App\Command;

use Arakne\Swf\Parser\Structure\Action\Opcode;
use Arakne\Swf\Parser\Structure\Action\Type;
use Arakne\Swf\Parser\Structure\Action\Value;
use Arakne\Swf\Parser\Structure\Tag\DoActionTag;
use Arakne\Swf\Parser\Structure\Tag\DoInitActionTag;
use Arakne\Swf\SwfFile;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Style\SymfonyStyle;

use function sprintf;

/**
 * Extract the full typed tree from a Dofus 1.29 lang SWF.
 *
 * Each lang SWF ships a structured data dump — not just translation strings
 * — and every namespace has its own natural schema:
 *
 *   lang_fr:    { FILE_BEGIN, VERSION, ACCEPT, A_ATTACK_B, ... }  (flat)
 *   items_fr:   { I: { u: { "1": {n, nn, d, t, l, ...}, ... },
 *                     t: { "1": {n, z}, ... }, st: {...}, ... } }
 *   spells_fr:  { S: { s: { "1": {n, d, e, ...}, ... }, ... } }
 *   monsters_fr:{ MSR: { m: { "1": {n, ...}, ... }, ... } }
 *   ...
 *
 * The runtime walks the AS2 bytecode (Push / GetVariable / GetMember /
 * SetVariable / SetMember / NewObject / InitObject / InitArray / StringAdd /
 * Add2 / DefineLocal / Pop / CallMethod / CallFunction / DefineFunction) and
 * mirrors what the Flash VM would do: globals get written with nested
 * objects/arrays preserving every type (string, int, float, bool, array,
 * object). The output is just the live globals tree after execution, so
 * callers can drill in using the same shape the original client code did.
 *
 * Output JSON shape:
 *   {
 *     "schema": "dofus-lang/v2",
 *     "data":   <the globals tree>,
 *     "stats":  { poolSize, topLevelKeys, unknownOpcodes }
 *   }
 */
class ExtractLangsCommand extends Command
{
    protected function configure(): void
    {
        $this
            ->setName('langs:extract')
            ->setDescription('Extract a lang SWF into a typed JSON tree')
            ->addOption('input', 'i', InputOption::VALUE_REQUIRED, 'Path to lang_*.swf')
            ->addOption('output', 'o', InputOption::VALUE_REQUIRED, 'Output JSON path');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        $swfPath = (string) $input->getOption('input');
        $outPath = (string) $input->getOption('output');

        if (!$swfPath || !file_exists($swfPath)) {
            $io->error('Missing or invalid --input');
            return Command::FAILURE;
        }
        if (!$outPath) {
            $io->error('Missing --output');
            return Command::FAILURE;
        }

        $swf = new SwfFile($swfPath);
        if (!$swf->valid()) {
            $io->error("Invalid SWF: $swfPath");
            return Command::FAILURE;
        }

        $vm = new LangVm();

        foreach ($swf->tags() as $tag) {
            if (!($tag instanceof DoActionTag || $tag instanceof DoInitActionTag)) continue;
            foreach ($tag->actions ?? [] as $action) {
                $this->exec($vm, $action);
            }
        }

        $payload = [
            'schema' => 'dofus-lang/v2',
            'data' => $vm->globals,
            'stats' => [
                'poolSize' => count($vm->pool),
                'topLevelKeys' => array_keys($vm->globals),
                'unknownOpcodes' => $vm->unknownOpcodes,
            ],
        ];

        @mkdir(dirname($outPath), 0755, true);
        file_put_contents(
            $outPath,
            json_encode(
                $payload,
                JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT
            )
        );

        $io->success(sprintf(
            'Wrote %s (%d top-level keys)',
            $outPath,
            count($vm->globals)
        ));
        return Command::SUCCESS;
    }

    private function exec(LangVm $vm, object $action): void
    {
        $opcode = $action->opcode;

        switch ($opcode) {
            case Opcode::ActionConstantPool: {
                $pool = $action->data ?? [];
                if (is_array($pool)) {
                    $vm->pool = array_values(array_map('strval', $pool));
                }
                return;
            }

            case Opcode::ActionPush: {
                $values = $action->data ?? [];
                if (!is_array($values)) return;
                foreach ($values as $v) {
                    $vm->stack[] = $this->resolvePush($vm, $v);
                }
                return;
            }

            case Opcode::ActionPop: {
                array_pop($vm->stack);
                return;
            }

            case Opcode::ActionStringAdd:
            case Opcode::ActionAdd2: {
                $b = array_pop($vm->stack);
                $a = array_pop($vm->stack);
                if ($opcode === Opcode::ActionStringAdd || is_string($a) || is_string($b)) {
                    $vm->stack[] = $this->toStr($a) . $this->toStr($b);
                } elseif ((is_int($a) || is_float($a)) && (is_int($b) || is_float($b))) {
                    $vm->stack[] = $a + $b;
                } else {
                    $vm->stack[] = null;
                }
                return;
            }

            case Opcode::ActionSetVariable: {
                $value = array_pop($vm->stack);
                $name = array_pop($vm->stack);
                if (is_string($name)) {
                    $vm->globals[$name] = $this->materialize($value);
                }
                return;
            }

            case Opcode::ActionGetVariable: {
                $name = array_pop($vm->stack);
                $vm->stack[] = is_string($name) ? new Ref([$name]) : null;
                return;
            }

            case Opcode::ActionSetMember: {
                $value = array_pop($vm->stack);
                $member = array_pop($vm->stack);
                $obj = array_pop($vm->stack);
                if ($obj instanceof Ref && (is_string($member) || is_int($member) || is_float($member))) {
                    $this->setByPath(
                        $vm->globals,
                        $obj->path,
                        $this->keyOf($member),
                        $this->materialize($value)
                    );
                }
                return;
            }

            case Opcode::ActionGetMember: {
                $member = array_pop($vm->stack);
                $obj = array_pop($vm->stack);
                if ($obj instanceof Ref && (is_string($member) || is_int($member) || is_float($member))) {
                    $vm->stack[] = new Ref(
                        array_merge($obj->path, [$this->keyOf($member)])
                    );
                } else {
                    $vm->stack[] = null;
                }
                return;
            }

            case Opcode::ActionNewObject: {
                $name = array_pop($vm->stack);
                $argCount = array_pop($vm->stack);
                if (is_int($argCount)) {
                    for ($i = 0; $i < $argCount; $i++) array_pop($vm->stack);
                }
                $className = is_string($name) ? $name : 'Object';
                $vm->stack[] = new LangData($className === 'Array');
                return;
            }

            case Opcode::ActionInitObject: {
                $count = array_pop($vm->stack);
                $obj = new LangData(false);
                if (is_int($count)) {
                    // Stack (top→bottom before we started popping count):
                    //   count, key_n, value_n, ..., key_1, value_1
                    // So popping pairs gives us value+key, oldest last.
                    $pairs = [];
                    for ($i = 0; $i < $count; $i++) {
                        $v = array_pop($vm->stack);
                        $k = array_pop($vm->stack);
                        $pairs[] = [$k, $v];
                    }
                    foreach (array_reverse($pairs) as [$k, $v]) {
                        $obj->entries[$this->keyOf($k)] = $v;
                    }
                }
                $vm->stack[] = $obj;
                return;
            }

            case Opcode::ActionInitArray: {
                $count = array_pop($vm->stack);
                $arr = new LangData(true);
                if (is_int($count)) {
                    $items = [];
                    for ($i = 0; $i < $count; $i++) $items[] = array_pop($vm->stack);
                    $items = array_reverse($items);
                    foreach ($items as $i => $v) $arr->entries[$i] = $v;
                }
                $vm->stack[] = $arr;
                return;
            }

            case Opcode::ActionDefineLocal: {
                $value = array_pop($vm->stack);
                $name = array_pop($vm->stack);
                if (is_string($name)) {
                    $vm->globals[$name] = $this->materialize($value);
                }
                return;
            }

            case Opcode::ActionDefineLocal2: {
                array_pop($vm->stack);
                return;
            }

            case Opcode::ActionCallMethod: {
                $member = array_pop($vm->stack);
                $obj = array_pop($vm->stack);
                $argCount = array_pop($vm->stack);
                if (is_int($argCount)) {
                    for ($i = 0; $i < $argCount; $i++) array_pop($vm->stack);
                }
                unset($member, $obj);
                $vm->stack[] = null;
                return;
            }

            case Opcode::ActionCallFunction: {
                $name = array_pop($vm->stack);
                $argCount = array_pop($vm->stack);
                if (is_int($argCount)) {
                    for ($i = 0; $i < $argCount; $i++) array_pop($vm->stack);
                }
                unset($name);
                $vm->stack[] = null;
                return;
            }

            case Opcode::ActionDefineFunction:
            case Opcode::ActionDefineFunction2: {
                $vm->stack[] = new Ref(['__function__']);
                return;
            }

            case Opcode::Null: {
                // Action-stream terminator — no-op, reached at end of every block.
                return;
            }

            default: {
                $vm->unknownOpcodes[$opcode->name] =
                    ($vm->unknownOpcodes[$opcode->name] ?? 0) + 1;
                return;
            }
        }
    }

    /**
     * Convert anything on the stack into a plain, JSON-serialisable value:
     *
     *   scalar  → itself
     *   Ref     → null (a Ref stored as a value means we lost track)
     *   LangData → PHP array; sequential if isArray AND keys are dense 0..N-1,
     *              associative otherwise
     *
     * Nested LangData is walked recursively, so `I.u[12] = {n,d,t,l}` becomes
     * `["n"=>..., "d"=>..., "t"=>..., "l"=>...]` and `I.s[42] = [[1,2],[3,4]]`
     * becomes `[[1,2],[3,4]]`.
     */
    private function materialize(mixed $value): mixed
    {
        if ($value instanceof LangData) {
            $dense = $value->isArray
                && !empty($value->entries)
                && array_keys($value->entries) === range(0, count($value->entries) - 1);
            $out = $dense ? [] : new \stdClass();
            foreach ($value->entries as $k => $v) {
                if ($dense) {
                    $out[] = $this->materialize($v);
                } else {
                    $out->{(string) $k} = $this->materialize($v);
                }
            }
            return $out;
        }
        if ($value instanceof Ref) {
            return null;
        }
        return $value;
    }

    /**
     * Walk into (and auto-create) the nested tree at `$pathPrefix`, then set
     * `$key` to `$value`. Existing intermediate non-object nodes get replaced
     * with a fresh container so later writes don't silently drop values.
     */
    private function setByPath(array &$container, array $pathPrefix, string $key, mixed $value): void
    {
        if (empty($pathPrefix)) {
            $container[$key] = $value;
            return;
        }
        $cur = &$container;
        foreach ($pathPrefix as $seg) {
            $seg = (string) $seg;
            if (is_object($cur)) {
                if (!isset($cur->{$seg}) || !(is_object($cur->{$seg}) || is_array($cur->{$seg}))) {
                    $cur->{$seg} = new \stdClass();
                }
                $cur = &$cur->{$seg};
            } else {
                if (!isset($cur[$seg]) || !(is_object($cur[$seg]) || is_array($cur[$seg]))) {
                    $cur[$seg] = new \stdClass();
                }
                $cur = &$cur[$seg];
            }
        }
        if (is_object($cur)) {
            $cur->{$key} = $value;
        } else {
            $cur[$key] = $value;
        }
    }

    private function keyOf(mixed $v): string
    {
        if (is_int($v)) return (string) $v;
        if (is_float($v)) return (string) $v;
        if (is_bool($v)) return $v ? 'true' : 'false';
        if (is_string($v)) return $v;
        return '';
    }

    private function resolvePush(LangVm $vm, mixed $v): mixed
    {
        if (!($v instanceof Value)) return $v;
        return match ($v->type) {
            Type::String => (string) $v->value,
            Type::Integer => (int) $v->value,
            Type::Float, Type::Double => (float) $v->value,
            Type::Boolean => (bool) $v->value,
            Type::Null, Type::Undefined => null,
            Type::Register => new Ref(['__reg__', (string) $v->value]),
            Type::Constant8, Type::Constant16 => $vm->pool[(int) $v->value] ?? '',
        };
    }

    private function toStr(mixed $v): string
    {
        if (is_string($v)) return $v;
        if (is_int($v) || is_float($v)) return (string) $v;
        if (is_bool($v)) return $v ? 'true' : 'false';
        if ($v instanceof Ref) return '[' . implode('.', $v->path) . ']';
        if ($v instanceof LangData) return '[Object]';
        return '';
    }
}

final class LangVm
{
    /** @var list<mixed> */
    public array $stack = [];
    /** @var array<string,mixed> Full nested tree of globals written by the walked bytecode. */
    public array $globals = [];
    /** @var list<string> */
    public array $pool = [];
    /** @var array<string,int> */
    public array $unknownOpcodes = [];
}

final class Ref
{
    /** @param list<string> $path */
    public function __construct(public array $path) {}
}

final class LangData
{
    /** @var array<string|int,mixed> */
    public array $entries = [];

    public function __construct(public bool $isArray) {}
}
