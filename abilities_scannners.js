import { system } from '@minecraft/server';

const scanLedge = (player, lenient = false) => {
    const loc = player.location;
    const rotY = typeof player.getRotation === 'function' ? player.getRotation().y : player.rotation.y;
    const bodyYawRad = rotY * (Math.PI / 180);
    
    const direcoes = lenient ? [
        { x: -Math.sin(bodyYawRad), z: Math.cos(bodyYawRad) },
        { x: -Math.sin(bodyYawRad + 0.3), z: Math.cos(bodyYawRad + 0.3) },
        { x: -Math.sin(bodyYawRad - 0.3), z: Math.cos(bodyYawRad - 0.3) }
    ] : [
        { x: -Math.sin(bodyYawRad), z: Math.cos(bodyYawRad) }
    ];

    const scanHeights = lenient ? [1.2, 1.3, 1.4] : [1.3];
    const maxDistance = 0.7;

    for (const hOff of scanHeights) {
        for (const bodyDir of direcoes) {
            const origem = { x: loc.x, y: loc.y + hOff, z: loc.z };
            
            const raio = player.dimension.getBlockFromRay(origem, { x: bodyDir.x, y: 0, z: bodyDir.z }, {
                maxDistance: 2.0, 
                includePassableBlocks: false, 
                includeLiquidBlocks: false    
            });

            if (raio && raio.block && !raio.block.isAir && !raio.block.isLiquid) {
                const blockX = raio.block.location.x;
                const blockZ = raio.block.location.z;
                
                let distanceToBlock;
                
                if (Math.abs(bodyDir.x) > Math.abs(bodyDir.z)) {
                    distanceToBlock = bodyDir.x > 0 ? blockX - loc.x : loc.x - (blockX + 1);
                } else {
                    distanceToBlock = bodyDir.z > 0 ? blockZ - loc.z : loc.z - (blockZ + 1);
                }
                
                const dist = Math.abs(distanceToBlock);

                if (dist <= maxDistance && dist > 0) {
                    return raio.block;
                }
            }
        }
    }
    return false;
};

const scanWall = (player) => {
    const loc = player.location;
    const rotY = typeof player.getRotation === 'function' ? player.getRotation().y : player.rotation.y;
    const yawRad = rotY * (Math.PI / 180);

    const direcoes = [
        { x: -Math.sin(yawRad), z: Math.cos(yawRad) },
        { x: Math.sin(yawRad), z: -Math.cos(yawRad) },
        { x: Math.cos(yawRad), z: Math.sin(yawRad) },
        { x: -Math.cos(yawRad), z: -Math.sin(yawRad) }
    ];

    const WALL_SLIDE_ACTIVATION_DISTANCE = 0.65;

    for (const dir of direcoes) {
        try {
            const ray = player.dimension.getBlockFromRay(
                { x: loc.x, y: loc.y + 0.8, z: loc.z }, 
                { x: dir.x, y: 0, z: dir.z },
                { maxDistance: 2.0, includePassableBlocks: true, includeLiquidBlocks: false }
            );

            if (ray && ray.block && !ray.block.isAir && !ray.block.isLiquid) {
                const blockId = ray.block.typeId;
                
                if (blockId.includes("ladder") || blockId.includes("vine") || ray.block.isPassable) {
                    continue; 
                }

                const blockLoc = ray.block.location;
                const dist = Math.sqrt(Math.pow((blockLoc.x + 0.5) - loc.x, 2) + Math.pow((blockLoc.z + 0.5) - loc.z, 2)) - 0.5;
                
                if (dist <= WALL_SLIDE_ACTIVATION_DISTANCE) {
                    const dx = (blockLoc.x + 0.5) - loc.x;
                    const dz = (blockLoc.z + 0.5) - loc.z;
                    let normX = 0, normZ = 0;
                    
                    if (Math.abs(dx) > Math.abs(dz)) {
                        normX = Math.sign(dx);
                    } else {
                        normZ = Math.sign(dz);
                    }
                    
                    return { dir: { x: normX, z: normZ }, block: ray.block }; 
                }
            }
        } catch (e) {}
    }
    return null;
};

const PONTOS_DE_CHECAGEM = [-0.29, 0, 0.29];

const extrairVetorDeDirecao = (player) => {
    const rotacaoPlayer = typeof player.getRotation === 'function' ? player.getRotation() : player.rotation;
    const yawRadianos = rotacaoPlayer.y * Math.PI / 180;
    const inputs = player.inputInfo?.getMovementVector() || { x: 0, y: 1 };
    
    return {
        x: inputs.x * Math.cos(yawRadianos) - inputs.y * Math.sin(yawRadianos),
        z: inputs.x * Math.sin(yawRadianos) + inputs.y * Math.cos(yawRadianos),
        ativo: inputs.x !== 0 || inputs.y !== 0
    };
};

const analisarNivelDoChao = (dimension, location) => {
    let melhorResultado = { bloco: null, distancia: Infinity };
    
    for (const eixoX of PONTOS_DE_CHECAGEM) {
        for (const eixoZ of PONTOS_DE_CHECAGEM) {
            const posicaoAlvo = { x: location.x + eixoX, y: location.y, z: location.z + eixoZ };
            const raio = dimension.getBlockFromRay(posicaoAlvo, { x: 0, y: -1, z: 0 }, { maxDistance: 2, includePassableBlocks: false, includeLiquidBlocks: false });
            
            if (raio && raio.block) {
                const queda = location.y - (raio.block.location.y + 1);
                if (queda < melhorResultado.distancia) {
                    melhorResultado.distancia = queda;
                    melhorResultado.bloco = raio.block;
                }
            }
        }
    }
    return melhorResultado;
};

const procurarParedesNaFrente = (dimension, location, vetorMovimento) => {
    const alturasDeCorte = [0.2, 0.4, 0.7]; 
    const magnitudeVetor = Math.sqrt(vetorMovimento.x * vetorMovimento.x + vetorMovimento.z * vetorMovimento.z);
    
    if (magnitudeVetor === 0) return false;
    const direcaoNormalizada = { x: vetorMovimento.x / magnitudeVetor, z: vetorMovimento.z / magnitudeVetor };
    
    for (const eixoX of PONTOS_DE_CHECAGEM) {
        for (const eixoZ of PONTOS_DE_CHECAGEM) {
            const origemBase = { x: location.x + eixoX, y: location.y, z: location.z + eixoZ };
            
            for (const compensacaoY of alturasDeCorte) {
                const origemDoRaio = { x: origemBase.x, y: origemBase.y + compensacaoY, z: origemBase.z };
                const impacto = dimension.getBlockFromRay(origemDoRaio, { x: direcaoNormalizada.x, y: 0, z: direcaoNormalizada.z }, { maxDistance: 1, includePassableBlocks: false, includeLiquidBlocks: false });
                
                if (impacto && impacto.block && !impacto.block.isAir && !impacto.block.isLiquid) {
                    const distanciaDoImpacto = impacto.distance ?? 0;
                    if (distanciaDoImpacto <= 0.05) return true;
                }
            }
        }
    }
    return false;
};

const procurarPrecipicios = (dimension, location, vetorMovimento, blocoDeBase) => {
    const estaSeMovendo = vetorMovimento.x !== 0 || vetorMovimento.z !== 0;
    const avanço = estaSeMovendo ? 0.05 : 0;
    const resultadoFenda = { temQueda: false };
    const alturaBase = (blocoDeBase ? blocoDeBase.location.y + 1 : location.y) + 0.1;
    const alturaMaximaPermitida = alturaBase + 1.0;
    
    for (const eixoX of PONTOS_DE_CHECAGEM) {
        for (const eixoZ of PONTOS_DE_CHECAGEM) {
            const alvoLeitura = { x: location.x + (vetorMovimento.x * avanço) + eixoX, y: alturaBase, z: location.z + (vetorMovimento.z * avanço) + eixoZ };
            const leituraDeVazio = dimension.getBlockFromRay(alvoLeitura, { x: 0, y: 1, z: 0 }, { maxDistance: 1, includePassableBlocks: false, includeLiquidBlocks: false });
            
            if (leituraDeVazio && leituraDeVazio.block && !leituraDeVazio.block.isAir && leituraDeVazio.block.location.y <= alturaMaximaPermitida) {
                resultadoFenda.temQueda = true;
            }
        }
    }
    return resultadoFenda;
};

const procurarParedesCrawl = (dimension, location, vetorMovimento) => {
    const alturasDeCorte = [0.13, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]; 
    const magnitudeVetor = Math.sqrt(vetorMovimento.x * vetorMovimento.x + vetorMovimento.z * vetorMovimento.z);
    
    if (magnitudeVetor === 0) return false;
    const direcaoNormalizada = { x: vetorMovimento.x / magnitudeVetor, z: vetorMovimento.z / magnitudeVetor };
    
    for (const eixoX of PONTOS_DE_CHECAGEM) {
        for (const eixoZ of PONTOS_DE_CHECAGEM) {
            const origemBase = { x: location.x + eixoX, y: location.y, z: location.z + eixoZ };
            
            for (const compensacaoY of alturasDeCorte) {
                const origemDoRaio = { x: origemBase.x, y: origemBase.y + compensacaoY, z: origemBase.z };
                const impacto = dimension.getBlockFromRay(origemDoRaio, { x: direcaoNormalizada.x, y: 0, z: direcaoNormalizada.z }, { maxDistance: 1, includePassableBlocks: false, includeLiquidBlocks: false });
                
                if (impacto && impacto.block && !impacto.block.isAir && !impacto.block.isLiquid) {
                    const distanciaDoImpacto = impacto.distance ?? 0;
                    if (distanciaDoImpacto <= 0.05) return true;
                }
            }
        }
    }
    return false;
};

const scanDashFrontalCollision = (player) => {
    try {
        const viewDir = typeof player.getViewDirection === 'function' ? player.getViewDirection() : player.viewDirection;
        let dx = viewDir.x, dz = viewDir.z;
        const mag = Math.sqrt(dx * dx + dz * dz);
        if (mag < 0.001) return false; 
        dx /= mag; dz /= mag;
        const width = 0.35, perpX = -dz * width, perpZ = dx * width;
        const pLoc = player.location, yCheck = pLoc.y + 0.6;
        const origins = [{ x: pLoc.x, y: yCheck, z: pLoc.z }, { x: pLoc.x + perpX, y: yCheck, z: pLoc.z + perpZ }, { x: pLoc.x - perpX, y: yCheck, z: pLoc.z - perpZ }];
        for (const origin of origins) {
            const result = player.dimension.getBlockFromRay(origin, { x: dx, y: 0, z: dz }, { maxDistance: 1.0, includePassableBlocks: false, includeLiquidBlocks: false });
            if (result && result.block && !result.block.isAir) return true; 
        }
    } catch(e) {}
    return false;
};

const scanDashGap = (player) => {
    if (!player.isOnGround) return false;
    const viewDir = typeof player.getViewDirection === 'function' ? player.getViewDirection() : player.viewDirection;
    const loc = player.location;
    const horizMag = Math.hypot(viewDir.x, viewDir.z);
    if (horizMag < 0.01) return false;
    const checkLoc = { x: loc.x + ((viewDir.x / horizMag) * 0.6), y: loc.y - 0.5, z: loc.z + ((viewDir.z / horizMag) * 0.6) };
    try {
        const block = player.dimension.getBlock(checkLoc);
        if (!block || block.isAir || block.isLiquid) return true;
    } catch (e) {}
    return false;
};

const scanFallSafeGround = (player) => {
    const loc = player.location;
    const dim = player.dimension;
    const OFFSETS_OLD = [-0.29, 0, 0.29];
    const ACTIVATION_DIST_OLD = 1.5;
    let closestDist = Infinity;
    let found = false;

    for (const dx of OFFSETS_OLD) {
        for (const dz of OFFSETS_OLD) {
            const checkLoc = { 
                x: loc.x + dx, 
                y: loc.y + 0.5, 
                z: loc.z + dz 
            };

            const ray = dim.getBlockFromRay(checkLoc, { x: 0, y: -1, z: 0 }, { 
                maxDistance: ACTIVATION_DIST_OLD + 1.5, 
                includePassableBlocks: false,
                includeLiquidBlocks: false
            });

            if (ray && ray.block) {
                if (ray.block.isLiquid || ray.block.isWaterlogged) {
                    continue; 
                }

                const dist = loc.y - (ray.block.location.y + 1);
                
                if (dist < closestDist) {
                    closestDist = dist;
                    found = true;
                }
            }
        }
    }

    return found ? closestDist : Infinity;
};

const scanJumpFence = (player) => {
    try {
        const location = player.location;
        const rot = player.getRotation();
        const bodyYawRad = rot.y * (Math.PI / 180);
        const dirX = -Math.sin(bodyYawRad);
        const dirZ = Math.cos(bodyYawRad);

        const checkLoc = {
            x: location.x + (dirX * 0.8),
            y: location.y + 0.5,
            z: location.z + (dirZ * 0.8)
        };

        const targetBlock = player.dimension.getBlock(checkLoc);
        if (!targetBlock) return false;

        const blockId = targetBlock.typeId;

        if ((blockId.includes("fence") || blockId.includes("gate") || blockId.includes("wall")) &&
            !blockId.includes("banner") && !blockId.includes("sign")) {

            let temEspaco = true;
            const tLoc = targetBlock.location; 

            for (let i = 1; i <= 3; i++) {
                const checkBlock = player.dimension.getBlock({
                    x: tLoc.x,
                    y: tLoc.y + i,
                    z: tLoc.z
                });

                if (checkBlock && !checkBlock.isAir && !checkBlock.isLiquid) {
                    const topId = checkBlock.typeId;
                    
                    const isPassable = topId.includes("torch") || topId.includes("pickle") || 
                                       topId.includes("lantern") || topId.includes("carpet") || 
                                       topId.includes("plate") || topId.includes("button") || 
                                       topId.includes("sign") || topId.includes("banner") || 
                                       topId.includes("chain") || topId.includes("rod") ||
                                       topId.includes("skull") || topId.includes("head");

                    if (!isPassable) {
                        temEspaco = false;
                        break; 
                    }
                }
            }

            if (!temEspaco) {
                return false;
            }

            const belowBlock = player.dimension.getBlock({
                x: tLoc.x,
                y: tLoc.y - 1,
                z: tLoc.z
            });

            if (belowBlock) {
                const belowId = belowBlock.typeId;
                if (belowId.includes("fence") || belowId.includes("gate") || belowId.includes("wall")) {
                    return false;
                }
            }
            
            return true;
        }
    } catch(e) {}
    
    return false;
};

const scanFeetInWater = (player) => {
    try {
        const loc = player.location;
        const feetLoc = { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) };
        const block = player.dimension.getBlock(feetLoc);

        return block && (block.isLiquid || block.isWaterlogged);
    } catch (e) {
        return false;
    }
};

const scanClimbable = (player) => {
    try {
        const loc = player.location;
        const footBlock = player.dimension.getBlock({ x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) });
        const headBlock = player.dimension.getBlock({ x: Math.floor(loc.x), y: Math.floor(loc.y + 1), z: Math.floor(loc.z) });
        
        const check = (block) => block && (block.typeId.includes("ladder") || block.typeId.includes("vine") || block.typeId.includes("scaffolding"));
        
        return check(footBlock) || check(headBlock);
    } catch (e) {
        return false;
    }
};

export const BlockScanner = {
    scan: (player, tick, options = {}) => {
        const { 
            needLedge = false, 
            lenientLedge = false, 
            needWall = false,
            needSlideMovement = false,
            needSlideGround = false,
            needSlideWall = false,
            needSlideGap = false,
            needCrawlWall = false, 
            needCrawlGap = false,
            slideVetorMovimento = null, 
            slideChaoBloco = null,
            crawlVetorMovimento = null,
            needDashFrontalCollision = false,
            needDashGap = false,
            needFallSafeGround = false,
            needJumpFence = false,
            needSpectralWaterCheck = false,
            needClimbableCheck = false 
        } = options;
        
        const result = {};
        const loc = player.location;
        const dim = player.dimension;

        if (needLedge) result.ledge = scanLedge(player, lenientLedge);
        if (needWall) result.wall = scanWall(player);

        if (needSlideMovement || needCrawlWall || needCrawlGap) {
            result.slideMovement = extrairVetorDeDirecao(player);
        }

        if (needSlideGround) result.slideGround = analisarNivelDoChao(dim, loc);

        if (needSlideWall) {
            const vetor = slideVetorMovimento || result.slideMovement;
            result.slideWall = procurarParedesNaFrente(dim, loc, vetor);
        }
        
        if (needCrawlWall) {
            const vetor = crawlVetorMovimento || result.slideMovement;
            result.crawlWall = procurarParedesCrawl(dim, loc, vetor);
        }

        if (needSlideGap) {
            const vetor = slideVetorMovimento || result.slideMovement;
            const chao = slideChaoBloco || analisarNivelDoChao(dim, loc).bloco;
            result.slideGap = procurarPrecipicios(dim, loc, vetor, chao);
        }
        
        if (needCrawlGap) {
            const vetor = crawlVetorMovimento || result.slideMovement;
            result.crawlGap = procurarPrecipicios(dim, loc, vetor, null);
        }

        if (needDashFrontalCollision) result.dashFrontalCollision = scanDashFrontalCollision(player);
        if (needDashGap) result.dashGap = scanDashGap(player);
        if (needFallSafeGround) result.fallSafeGround = scanFallSafeGround(player);
        if (needJumpFence) result.jumpFence = scanJumpFence(player);
        
        if (needSpectralWaterCheck) {
            result.spectralWaterCheck = scanFeetInWater(player);
        }

        if (needClimbableCheck) {
            result.isClimbable = scanClimbable(player);
        }

        return result;
    }
};
